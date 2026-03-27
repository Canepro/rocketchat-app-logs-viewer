import { IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IUIKitBlockIncomingInteraction, IUIKitViewSubmitIncomingInteraction } from '@rocket.chat/apps-engine/definition/uikit/UIKitIncomingInteractionTypes';
import { UIKitSurfaceType } from '@rocket.chat/apps-engine/definition/uikit';
import { IUser } from '@rocket.chat/apps-engine/definition/users';

import { SETTINGS } from '../constants';
import { appendAuditEntry, hasAnyAllowedRole, parseAllowedRoles } from '../security/querySecurity';
import {
    decodeSlashCardActionPayload,
    encodeSlashCardActionPayload,
    formatSampleLines,
    isSlashCardActionId,
    SLASH_CARD_ACTION,
    SlashCardActionPayload,
} from './slashCardActions';
import { createShareElsewhereRequest, deleteShareElsewhereRequest, readShareElsewhereRequest } from './slashCardShareRequestStore';
import { readSlashCardSampleSnapshot } from './slashCardSampleStore';

const CODE_FENCE = '```';
const COPY_OUTPUT_MAX_LINES = 600;
const SHARE_OUTPUT_MAX_LINES = 600;
const SHARE_OUTPUT_MAX_PAGES = 12;
const SAMPLE_RENDER_MODE = 'full_line_priority';
const DEFAULT_MESSAGE_MAX_ALLOWED_SIZE = 5000;
const MESSAGE_SIZE_MIN = 1200;
const PRIVATE_COPY_CHAR_BUDGET_MIN = 20000;
const PRIVATE_COPY_CHAR_BUDGET_MAX = 60000;
const PRIVATE_COPY_CHAR_BUDGET_MULTIPLIER = 6;
const SHARE_ELSEWHERE_MODAL_ID_PREFIX = 'logs_slash_share_elsewhere_modal:';
const SHARE_ELSEWHERE_BLOCK_ID = 'share_elsewhere_target_room';
const SHARE_ELSEWHERE_ACTION_ID = 'share_elsewhere_target_room_input';
const SHARE_ELSEWHERE_THREAD_BLOCK_ID = 'share_elsewhere_target_thread';
const SHARE_ELSEWHERE_THREAD_ACTION_ID = 'share_elsewhere_target_thread_input';

type ShareRenderResult = {
    displayedCount: number;
    pageCount: number;
    threadId?: string;
    totalCount: number;
    truncated: boolean;
    partialPublish: boolean;
};

type SharePage = {
    text: string;
    displayedCount: number;
};

type FittedRenderedLines = {
    lines: Array<string>;
    nextIndex: number;
    text: string;
};

export const handleSlashCardBlockAction = async (
    appId: string,
    interaction: IUIKitBlockIncomingInteraction,
    read: IRead,
    modify: IModify,
    persistence: IPersistence,
): Promise<boolean> => {
    if (!isSlashCardActionId(interaction.actionId)) {
        return false;
    }

    const appUser = await read.getUserReader().getAppUser(appId);
    if (!appUser) {
        return true;
    }

    // Interaction payload may omit roles in some clients; load canonical user record for auth checks.
    const actor = await read.getUserReader().getById(interaction.user.id) || interaction.user;

    const payload = decodeSlashCardActionPayload(interaction.value);
    if (!payload) {
        // Interaction value can be stale/edited; fail safely and ask user to re-run /logs.
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            'Slash-card action payload is missing or invalid.',
            'Run `/logs` again and retry.',
        ]);
        return true;
    }

    // Resolve sample context from per-user persisted snapshot so actions stay reliable with large samples.
    const resolvedPayload = await resolveActionPayloadForActor(read, actor.id, payload);
    if (!resolvedPayload) {
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            'Sample details are no longer available for this slash card.',
            'Run `/logs` again to refresh the quick triage snapshot.',
        ]);
        return true;
    }

    const roomContext = await resolveRoomContext(read, interaction.room, resolvedPayload.roomId);

    const settingsReader = read.getEnvironmentReader().getSettings();
    const [allowedRolesRaw, retentionDaysRaw, maxEntriesRaw, messageMaxAllowedRaw] = await Promise.all([
        settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
        settingsReader.getValueById(SETTINGS.AUDIT_RETENTION_DAYS),
        settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
        safeReadSettingById(settingsReader, 'Message_MaxAllowedSize'),
    ]);
    const allowedRoles = parseAllowedRoles(allowedRolesRaw);
    const auditRetentionDays = readNumber(retentionDaysRaw, 7, 1, 90);
    const auditMaxEntries = readNumber(maxEntriesRaw, 2000, 100, 10000);
    const messageMaxAllowedSize = readNumber(
        messageMaxAllowedRaw,
        DEFAULT_MESSAGE_MAX_ALLOWED_SIZE,
        MESSAGE_SIZE_MIN,
        50000,
    );
    const shareMessageMaxChars = Math.max(MESSAGE_SIZE_MIN, messageMaxAllowedSize);
    const privateCopyBudgetChars = Math.max(
        PRIVATE_COPY_CHAR_BUDGET_MIN,
        Math.min(PRIVATE_COPY_CHAR_BUDGET_MAX, messageMaxAllowedSize * PRIVATE_COPY_CHAR_BUDGET_MULTIPLIER),
    );

    if (!hasAnyAllowedRole(actor.roles, allowedRoles)) {
        // Re-check authorization at click time so role changes are honored immediately.
        if (interaction.actionId === SLASH_CARD_ACTION.SHARE_SAMPLE || interaction.actionId === SLASH_CARD_ACTION.SHARE_ELSEWHERE) {
            await appendAuditEntry(
                read,
                persistence,
                {
                    action: interaction.actionId === SLASH_CARD_ACTION.SHARE_ELSEWHERE ? 'share_elsewhere_denied' : 'share_denied',
                    userId: actor.id,
                    outcome: 'denied',
                    reason: 'role_denied',
                    scope: {
                        source: 'slash_card',
                        roomId: resolvedPayload.roomId,
                        threadId: resolvedPayload.threadId || null,
                    },
                },
                auditRetentionDays,
                auditMaxEntries,
            );
        }

        await notifyUserOnly(actor, roomContext, appUser, modify, [
            'You do not have permission to use this `/logs` action.',
        ]);
        return true;
    }

    if (interaction.actionId === SLASH_CARD_ACTION.COPY_SAMPLE) {
        await notifyUserOnly(
            actor,
            roomContext,
            appUser,
            modify,
            buildCopyResponseLines(resolvedPayload, privateCopyBudgetChars),
        );
        return true;
    }

    if (interaction.actionId === SLASH_CARD_ACTION.SHARE_ELSEWHERE) {
        const rawActionPayload = typeof interaction.value === 'string'
            ? interaction.value
            : encodeSlashCardActionPayload(resolvedPayload);
        const requestId = await createShareElsewhereRequest(read, persistence, actor.id, rawActionPayload);
        if (!requestId) {
            await notifyUserOnly(actor, roomContext, appUser, modify, [
                'Could not prepare Share elsewhere request.',
                'Run `/logs` again and retry.',
            ]);
            return true;
        }

        await openShareElsewhereModal(modify, actor, interaction.triggerId, requestId, resolvedPayload);
        return true;
    }

    await handleShareSample(
        actor,
        roomContext,
        interaction.threadId,
        resolvedPayload,
        appUser,
        read,
        modify,
        persistence,
        auditRetentionDays,
        auditMaxEntries,
        shareMessageMaxChars,
    );
    return true;
};

export const handleSlashCardViewSubmit = async (
    appId: string,
    interaction: IUIKitViewSubmitIncomingInteraction,
    read: IRead,
    modify: IModify,
    persistence: IPersistence,
): Promise<boolean> => {
    const modalId = typeof interaction.view?.id === 'string' ? interaction.view.id : '';
    if (!modalId.startsWith(SHARE_ELSEWHERE_MODAL_ID_PREFIX)) {
        return false;
    }

    const requestId = modalId.slice(SHARE_ELSEWHERE_MODAL_ID_PREFIX.length).trim();
    const appUser = await read.getUserReader().getAppUser(appId);
    if (!appUser) {
        return true;
    }

    const actor = await read.getUserReader().getById(interaction.user.id) || interaction.user;
    const settingsReader = read.getEnvironmentReader().getSettings();
    const [allowedRolesRaw, retentionDaysRaw, maxEntriesRaw, messageMaxAllowedRaw] = await Promise.all([
        settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
        settingsReader.getValueById(SETTINGS.AUDIT_RETENTION_DAYS),
        settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
        safeReadSettingById(settingsReader, 'Message_MaxAllowedSize'),
    ]);
    const allowedRoles = parseAllowedRoles(allowedRolesRaw);
    const auditRetentionDays = readNumber(retentionDaysRaw, 7, 1, 90);
    const auditMaxEntries = readNumber(maxEntriesRaw, 2000, 100, 10000);
    const messageMaxAllowedSize = readNumber(
        messageMaxAllowedRaw,
        DEFAULT_MESSAGE_MAX_ALLOWED_SIZE,
        MESSAGE_SIZE_MIN,
        50000,
    );
    const shareMessageMaxChars = Math.max(MESSAGE_SIZE_MIN, messageMaxAllowedSize);

    const targetRoomInput = readViewInput(interaction.view, SHARE_ELSEWHERE_BLOCK_ID, SHARE_ELSEWHERE_ACTION_ID);
    const targetThreadId = readViewInput(interaction.view, SHARE_ELSEWHERE_THREAD_BLOCK_ID, SHARE_ELSEWHERE_THREAD_ACTION_ID) || undefined;

    if (!hasAnyAllowedRole(actor.roles, allowedRoles)) {
        await appendAuditEntry(
            read,
            persistence,
            {
                action: 'share_elsewhere_denied',
                userId: actor.id,
                outcome: 'denied',
                reason: 'role_denied',
                scope: {
                    source: 'slash_card',
                    targetRoomInput: targetRoomInput || null,
                    targetThreadId: targetThreadId || null,
                },
            },
            auditRetentionDays,
            auditMaxEntries,
        );
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            'You do not have permission to use Share elsewhere.',
        ]);
        return true;
    }

    if (!requestId) {
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            'Share elsewhere request token is invalid or missing.',
            'Run `/logs` again and retry.',
        ]);
        return true;
    }

    const encodedPayload = await readShareElsewhereRequest(read, actor.id, requestId);
    if (!encodedPayload) {
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            'Share elsewhere request expired.',
            'Run `/logs` again to refresh sample context.',
        ]);
        return true;
    }

    const payload = decodeSlashCardActionPayload(encodedPayload);
    const resolvedPayload = payload ? await resolveActionPayloadForActor(read, actor.id, payload) : undefined;
    if (!resolvedPayload) {
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            'Sample details are no longer available for this slash card.',
            'Run `/logs` again to refresh the quick triage snapshot.',
        ]);
        return true;
    }

    if (!targetRoomInput) {
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            'Share elsewhere requires a target room value.',
            'Provide room ID or room name, then submit again.',
        ]);
        return true;
    }

    const targetRoom = await resolveTargetRoomForActor(read, actor.id, targetRoomInput);
    if (!targetRoom) {
        await appendAuditEntry(
            read,
            persistence,
            {
                action: 'share_elsewhere_denied',
                userId: actor.id,
                outcome: 'denied',
                reason: 'room_access_denied',
                scope: {
                    source: 'slash_card',
                    targetRoomInput,
                    targetThreadId: targetThreadId || null,
                },
            },
            auditRetentionDays,
            auditMaxEntries,
        );
        await notifyUserOnly(actor, interaction.room, appUser, modify, [
            `You do not have access to target room "${targetRoomInput}" or it does not exist.`,
        ]);
        return true;
    }

    if (targetThreadId) {
        const validThread = await validateThreadInRoom(read, targetThreadId, targetRoom.id);
        if (!validThread) {
            await appendAuditEntry(
                read,
                persistence,
                {
                    action: 'share_elsewhere_denied',
                    userId: actor.id,
                    outcome: 'denied',
                    reason: 'thread_invalid',
                    scope: {
                        source: 'slash_card',
                        roomId: targetRoom.id,
                        targetThreadId,
                    },
                },
                auditRetentionDays,
                auditMaxEntries,
            );
            await notifyUserOnly(actor, targetRoom, appUser, modify, [
                `Thread "${targetThreadId}" was not found in room "${targetRoom.displayName || targetRoom.slugifiedName}".`,
            ]);
            return true;
        }
    }

    const shareResult = await publishSharePayloadWithFallback(
        modify,
        appUser,
        targetRoom,
        targetThreadId,
        resolvedPayload,
        shareMessageMaxChars,
    );
    if (!shareResult) {
        await appendAuditEntry(
            read,
            persistence,
            {
                action: 'share_elsewhere_denied',
                userId: actor.id,
                outcome: 'denied',
                reason: 'publish_failed',
                scope: {
                    source: 'slash_card',
                    roomId: targetRoom.id,
                    targetThreadId: targetThreadId || null,
                },
            },
            auditRetentionDays,
            auditMaxEntries,
        );
        await notifyUserOnly(actor, targetRoom, appUser, modify, [
            'Share elsewhere failed while posting to Rocket.Chat.',
            'Run `/logs` again and retry.',
        ]);
        return true;
    }

    await deleteShareElsewhereRequest(read, persistence, actor.id, requestId);
    await appendAuditEntry(
        read,
        persistence,
        {
            action: 'share_elsewhere',
            userId: actor.id,
            outcome: 'allowed',
            scope: {
                source: 'slash_card',
                roomId: targetRoom.id,
                threadId: shareResult.threadId || null,
                sampleCount: shareResult.displayedCount,
                sampleTotalCount: shareResult.totalCount,
                pageCount: shareResult.pageCount,
            },
        },
        auditRetentionDays,
        auditMaxEntries,
    );
    await notifyUserOnly(actor, targetRoom, appUser, modify, [
        formatShareOutcomeMessage(
            shareResult,
            `${shareResult.threadId ? 'thread' : 'room'} in "${targetRoom.displayName || targetRoom.slugifiedName}"`,
        ),
    ]);

    return true;
};

const handleShareSample = async (
    actor: IUser,
    roomContext: IUIKitBlockIncomingInteraction['room'],
    interactionThreadId: string | undefined,
    payload: SlashCardActionPayload,
    appUser: IUser,
    read: IRead,
    modify: IModify,
    persistence: IPersistence,
    auditRetentionDays: number,
    auditMaxEntries: number,
    shareMessageMaxChars: number,
): Promise<void> => {
    if (!roomContext) {
        await notifyUserOnly(actor, roomContext, appUser, modify, [
            'Cannot share sample because room context is not available.',
        ]);
        return;
    }

    const roomId = roomContext.id || payload.roomId;
    const threadId = payload.threadId || interactionThreadId || undefined;
    const shareResult = await publishSharePayloadWithFallback(
        modify,
        appUser,
        roomContext,
        threadId,
        payload,
        shareMessageMaxChars,
    );
    if (!shareResult) {
        await appendAuditEntry(
            read,
            persistence,
            {
                action: 'share_denied',
                userId: actor.id,
                outcome: 'denied',
                reason: 'publish_failed',
                scope: {
                    source: 'slash_card',
                    roomId,
                    threadId: threadId || null,
                },
            },
            auditRetentionDays,
            auditMaxEntries,
        );

        await notifyUserOnly(actor, roomContext, appUser, modify, [
            'Share sample failed while posting to Rocket.Chat.',
            'If this card is stale or thread context changed, run `/logs` again and retry.',
        ]);
        return;
    }

    await appendAuditEntry(
        read,
        persistence,
        {
            action: 'share',
            userId: actor.id,
            outcome: 'allowed',
            scope: {
                source: 'slash_card',
                roomId,
                threadId: shareResult.threadId || null,
                sampleCount: shareResult.displayedCount,
                sampleTotalCount: shareResult.totalCount,
                pageCount: shareResult.pageCount,
            },
        },
        auditRetentionDays,
        auditMaxEntries,
    );

    await notifyUserOnly(actor, roomContext, appUser, modify, [
        formatShareOutcomeMessage(shareResult, `${shareResult.threadId ? 'thread' : 'room'} successfully`),
    ]);
};

const buildCopyResponseLines = (payload: SlashCardActionPayload, messageBudgetChars: number): Array<string> => {
    const sampleLines = formatSampleLines(payload, { withIndex: true, maxLines: COPY_OUTPUT_MAX_LINES });
    const fitted = fitRenderedLinesWindowToCharBudget(
        sampleLines,
        0,
        Math.max(MESSAGE_SIZE_MIN, messageBudgetChars),
        (lines, meta) => renderPrivateActionText(buildCopyResponseSections(payload, lines, getSampleStats(payload, lines.length, meta.hasMore))),
    );
    const sampleStats = getSampleStats(payload, fitted.lines.length, fitted.nextIndex < sampleLines.length);
    if (fitted.lines.length === 0) {
        return [
            'Copy-ready sample is unavailable for this result.',
            'Run query in Logs Viewer, then use Share sample if you need room-visible evidence.',
        ];
    }

    return buildCopyResponseSections(payload, fitted.lines, sampleStats);
};

const buildCopyResponseSections = (
    payload: SlashCardActionPayload,
    sampleLines: Array<string>,
    sampleStats: { displayedCount: number; totalCount: number; truncated: boolean },
): Array<string> => {
    if (sampleLines.length === 0) {
        return [
            'Copy-ready sample is unavailable for this result.',
            'Run query in Logs Viewer, then use Share sample if you need room-visible evidence.',
        ];
    }

    return [
        'Copy-ready sample (private):',
        'Clipboard note: this action cannot write to your local clipboard. Copy from the block below.',
        `Render mode: ${SAMPLE_RENDER_MODE} (more lines, exact line text).`,
        `${CODE_FENCE}\n${toCodeBlock(sampleLines.join('\n'))}\n${CODE_FENCE}`,
        `Lines=${sampleStats.displayedCount}/${sampleStats.totalCount} Source=${payload.sourceMode} Window=${payload.windowLabel} Filters=${payload.filterSummary}`,
        sampleStats.truncated ? 'Sample output was truncated for this private response. Use Open Logs Viewer for the full result.' : '',
    ].filter(Boolean);
};

const buildShareMessagePage = (
    payload: SlashCardActionPayload,
    sampleLines: Array<string>,
    page: { isContinuation: boolean; startLineNumber: number; endLineNumber: number; totalCount: number },
): string => {
    const lines = page.isContinuation
        ? [
            '*Logs sample continuation from `/logs`*',
            `Render mode: ${SAMPLE_RENDER_MODE}`,
            `Lines: ${page.startLineNumber}-${page.endLineNumber}/${page.totalCount}`,
        ]
        : [
            '*Logs sample shared from `/logs`*',
            `Source: \`${payload.sourceMode}\``,
            `Window: ${payload.windowLabel}`,
            `Filters: ${payload.filterSummary}`,
            `Preset: ${payload.preset}`,
            `Render mode: ${SAMPLE_RENDER_MODE}`,
            `Lines: ${sampleLines.length > 0 ? `${page.startLineNumber}-${page.endLineNumber}` : 0}/${page.totalCount}`,
        ];

    if (sampleLines.length === 0) {
        lines.push('No sampled lines were available in this slash response.');
        return lines.join('\n');
    }

    lines.push('Sample output:');
    lines.push(CODE_FENCE);
    lines.push(toCodeBlock(sampleLines.join('\n')));
    lines.push(CODE_FENCE);

    return lines.join('\n');
};

const openShareElsewhereModal = async (
    modify: IModify,
    actor: IUser,
    triggerId: string,
    requestId: string,
    payload: SlashCardActionPayload,
): Promise<void> => {
    const blocks = modify.getCreator().getBlockBuilder();
    blocks.addSectionBlock({
        text: blocks.newMarkdownTextObject('Share sampled lines to another room you can access.'),
    });
    blocks.addInputBlock({
        blockId: SHARE_ELSEWHERE_BLOCK_ID,
        label: blocks.newPlainTextObject('Target room (ID or name)'),
        element: blocks.newPlainTextInputElement({
            actionId: SHARE_ELSEWHERE_ACTION_ID,
            placeholder: blocks.newPlainTextObject('example: Support_Stuff or 68ef0...'),
            initialValue: payload.roomName,
        }),
    });
    blocks.addInputBlock({
        blockId: SHARE_ELSEWHERE_THREAD_BLOCK_ID,
        label: blocks.newPlainTextObject('Target thread ID (optional)'),
        optional: true,
        element: blocks.newPlainTextInputElement({
            actionId: SHARE_ELSEWHERE_THREAD_ACTION_ID,
            placeholder: blocks.newPlainTextObject('thread root message ID'),
        }),
    });
    blocks.addContextBlock({
        elements: [
            blocks.newMarkdownTextObject(`Sample: ${payload.sampleTotalCount || payload.sampleOutput.length} line(s), ${payload.windowLabel}`),
            blocks.newMarkdownTextObject('Only your accessible rooms are allowed.'),
        ],
    });

    await modify.getUiController().openSurfaceView(
        {
            type: UIKitSurfaceType.MODAL,
            id: `${SHARE_ELSEWHERE_MODAL_ID_PREFIX}${requestId}`,
            title: blocks.newPlainTextObject('Share Sample Elsewhere'),
            submit: blocks.newButtonElement({
                text: blocks.newPlainTextObject('Share'),
            }),
            close: blocks.newButtonElement({
                text: blocks.newPlainTextObject('Cancel'),
            }),
            blocks: blocks.getBlocks(),
        },
        { triggerId },
        actor,
    );
};

const readViewInput = (
    view: IUIKitViewSubmitIncomingInteraction['view'],
    blockId: string,
    actionId: string,
): string => {
    const state = view?.state as any;
    const candidates = [state?.values, state];
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') {
            continue;
        }

        const blockState = candidate[blockId];
        if (!blockState || typeof blockState !== 'object') {
            continue;
        }

        const actionState = blockState[actionId];
        const value = extractInputValue(actionState);
        if (value) {
            return value;
        }
    }

    return '';
};

const extractInputValue = (value: unknown): string => {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (!value || typeof value !== 'object') {
        return '';
    }

    const candidate = value as any;
    if (typeof candidate.value === 'string') {
        return candidate.value.trim();
    }
    if (typeof candidate.selectedOption?.value === 'string') {
        return candidate.selectedOption.value.trim();
    }
    if (typeof candidate.selected?.value === 'string') {
        return candidate.selected.value.trim();
    }

    return '';
};

const resolveTargetRoomForActor = async (
    read: IRead,
    actorId: string,
    targetRoomInput: string,
): Promise<IUIKitBlockIncomingInteraction['room']> => {
    const normalizedInput = targetRoomInput.trim().toLowerCase();
    if (!normalizedInput) {
        return undefined;
    }

    const roomIds = (await read.getUserReader().getUserRoomIds(actorId) || []).filter(Boolean);
    if (roomIds.includes(targetRoomInput)) {
        try {
            return await read.getRoomReader().getById(targetRoomInput);
        } catch {
            return undefined;
        }
    }

    const rooms = await Promise.all(roomIds.map(async (roomId) => {
        try {
            return await read.getRoomReader().getById(roomId);
        } catch {
            return undefined;
        }
    }));
    return rooms.find((room) => {
        if (!room) {
            return false;
        }

        const candidates = [
            room.id,
            room.displayName,
            room.slugifiedName,
            (room as any).name,
        ]
            .filter((item) => typeof item === 'string')
            .map((item) => (item as string).trim().toLowerCase());

        return candidates.includes(normalizedInput);
    });
};

const validateThreadInRoom = async (
    read: IRead,
    threadId: string,
    roomId: string,
): Promise<boolean> => {
    if (!threadId || !roomId) {
        return false;
    }

    const threadMessage = await read.getMessageReader().getById(threadId);
    if (!threadMessage) {
        return false;
    }

    const threadRoom = await read.getMessageReader().getRoom(threadId);
    return !!threadRoom && threadRoom.id === roomId;
};

const notifyUserOnly = async (
    user: IUser,
    room: IUIKitBlockIncomingInteraction['room'],
    appUser: IUser,
    modify: IModify,
    lines: Array<string>,
): Promise<void> => {
    const messageBuilder = modify.getCreator().startMessage();
    messageBuilder.setSender(appUser);
    if (room) {
        messageBuilder.setRoom(room);
    }
    messageBuilder.setGroupable(false);
    messageBuilder.setParseUrls(false);
    messageBuilder.setText(
        [
            'Only you can see this `/logs` action response.',
            '',
            ...lines,
        ].join('\n'),
    );

    await modify.getNotifier().notifyUser(user, messageBuilder.getMessage());
};

const renderPrivateActionText = (lines: Array<string>): string =>
    [
        'Only you can see this `/logs` action response.',
        '',
        ...lines,
    ].join('\n');

const toCodeBlock = (value: string): string => value.replace(/```/g, "'''");

const publishSharePayloadWithFallback = async (
    modify: IModify,
    appUser: IUser,
    roomContext: IUIKitBlockIncomingInteraction['room'],
    threadId: string | undefined,
    payload: SlashCardActionPayload,
    maxMessageChars: number,
): Promise<ShareRenderResult | null> => {
    if (!roomContext) {
        return null;
    }

    const rendered = renderSharePages(payload, maxMessageChars);
    if (rendered.pages.length === 0) {
        return {
            displayedCount: 0,
            pageCount: 0,
            totalCount: rendered.totalCount,
            truncated: rendered.truncated,
            partialPublish: false,
        };
    }

    if (!threadId) {
        try {
            const published = await publishSharePages(modify, appUser, roomContext, undefined, rendered.pages);
            return {
                ...published,
                displayedCount: rendered.displayedCount,
                totalCount: rendered.totalCount,
                truncated: rendered.truncated || published.partialPublish,
                partialPublish: published.partialPublish,
            };
        } catch {
            return null;
        }
    }

    try {
        const firstPageId = await publishShareMessage(modify, appUser, roomContext, threadId, rendered.pages[0].text);
        let postedPageCount = 1;
        let postedDisplayedCount = rendered.pages[0].displayedCount;
        let partialPublish = false;
        if (rendered.pages.length > 1) {
            const continuation = await publishShareContinuationPages(modify, appUser, roomContext, threadId, firstPageId, rendered.pages.slice(1));
            postedPageCount += continuation.pageCount;
            postedDisplayedCount += continuation.displayedCount;
            partialPublish = continuation.partialPublish;
        }
        return {
            threadId,
            pageCount: postedPageCount,
            displayedCount: postedDisplayedCount,
            totalCount: rendered.totalCount,
            truncated: rendered.truncated || partialPublish,
            partialPublish,
        };
    } catch {
        try {
            const published = await publishSharePages(modify, appUser, roomContext, undefined, rendered.pages);
            return {
                ...published,
                displayedCount: rendered.displayedCount,
                totalCount: rendered.totalCount,
                truncated: rendered.truncated || published.partialPublish,
                partialPublish: published.partialPublish,
            };
        } catch {
            return null;
        }
    }
};

const renderSharePages = (
    payload: SlashCardActionPayload,
    maxMessageChars: number,
): { pages: Array<SharePage>; displayedCount: number; totalCount: number; truncated: boolean } => {
    const sampleLines = formatSampleLines(payload, { withIndex: true, maxLines: SHARE_OUTPUT_MAX_LINES });
    const totalCount = Math.max(sampleLines.length, payload.sampleTotalCount || sampleLines.length);
    if (sampleLines.length === 0) {
        return {
            pages: [
                {
                    text: buildShareMessagePage(payload, [], {
                        isContinuation: false,
                        startLineNumber: 0,
                        endLineNumber: 0,
                        totalCount,
                    }),
                    displayedCount: 0,
                },
            ],
            displayedCount: 0,
            totalCount,
            truncated: false,
        };
    }

    const pages: Array<SharePage> = [];
    let nextIndex = 0;

    while (nextIndex < sampleLines.length && pages.length < SHARE_OUTPUT_MAX_PAGES) {
        const pageStartIndex = nextIndex;
        const fitted = fitRenderedLinesWindowToCharBudget(
            sampleLines,
            pageStartIndex,
            maxMessageChars,
            (lines) => buildShareMessagePage(payload, lines, {
                isContinuation: pages.length > 0,
                startLineNumber: pageStartIndex + 1,
                endLineNumber: pageStartIndex + lines.length,
                totalCount,
            }),
        );

        pages.push({
            text: fitted.text,
            displayedCount: fitted.lines.length,
        });
        nextIndex = fitted.nextIndex;
    }

    return {
        pages,
        displayedCount: pages.reduce((sum, page) => sum + page.displayedCount, 0),
        totalCount,
        truncated: nextIndex < sampleLines.length,
    };
};

const publishSharePages = async (
    modify: IModify,
    appUser: IUser,
    roomContext: NonNullable<IUIKitBlockIncomingInteraction['room']>,
    threadId: string | undefined,
    pages: Array<SharePage>,
): Promise<{ threadId?: string; pageCount: number; displayedCount: number; partialPublish: boolean }> => {
    const firstPageId = await publishShareMessage(modify, appUser, roomContext, threadId, pages[0].text);
    const continuationThreadId = threadId || (pages.length > 1 ? firstPageId : undefined);
    let pageCount = 1;
    let displayedCount = pages[0].displayedCount;
    let partialPublish = false;

    if (pages.length > 1) {
        if (!continuationThreadId) {
            return {
                threadId: undefined,
                pageCount,
                displayedCount,
                partialPublish: true,
            };
        }

        const continuation = await publishShareContinuationPages(modify, appUser, roomContext, continuationThreadId, firstPageId, pages.slice(1));
        pageCount += continuation.pageCount;
        displayedCount += continuation.displayedCount;
        partialPublish = continuation.partialPublish;
    }

    return {
        threadId: continuationThreadId,
        pageCount,
        displayedCount,
        partialPublish,
    };
};

const publishShareContinuationPages = async (
    modify: IModify,
    appUser: IUser,
    roomContext: NonNullable<IUIKitBlockIncomingInteraction['room']>,
    threadId: string | undefined,
    _rootMessageId: string | undefined,
    pages: Array<SharePage>,
): Promise<{ pageCount: number; displayedCount: number; partialPublish: boolean }> => {
    let pageCount = 0;
    let displayedCount = 0;
    for (const page of pages) {
        try {
            await publishShareMessage(modify, appUser, roomContext, threadId, page.text);
            pageCount += 1;
            displayedCount += page.displayedCount;
        } catch {
            return {
                pageCount,
                displayedCount,
                partialPublish: true,
            };
        }
    }

    return {
        pageCount,
        displayedCount,
        partialPublish: false,
    };
};

const publishShareMessage = async (
    modify: IModify,
    appUser: IUser,
    roomContext: NonNullable<IUIKitBlockIncomingInteraction['room']>,
    threadId: string | undefined,
    text: string,
): Promise<string | undefined> => {
    const messageBuilder = modify.getCreator().startMessage();
    messageBuilder.setSender(appUser);
    messageBuilder.setRoom(roomContext);
    messageBuilder.setGroupable(false);
    messageBuilder.setParseUrls(false);
    if (threadId) {
        messageBuilder.setThreadId(threadId);
    }
    messageBuilder.setText(text);

    const result = await modify.getCreator().finish(messageBuilder);
    return readPublishedMessageId(result);
};

const readNumber = (value: unknown, defaultValue: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }

    return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const safeReadSettingById = async (
    settingsReader: IRead['getEnvironmentReader'] extends () => infer T
        ? T extends { getSettings: () => infer S }
            ? S
            : never
        : never,
    settingId: string,
): Promise<unknown> => {
    try {
        return await settingsReader.getValueById(settingId);
    } catch {
        return undefined;
    }
};

const fitRenderedLinesWindowToCharBudget = (
    sampleLines: Array<string>,
    startIndex: number,
    maxChars: number,
    render: (lines: Array<string>, meta: { hasMore: boolean }) => string,
): FittedRenderedLines => {
    const safeMaxChars = Math.max(80, Math.floor(maxChars));
    const lines: Array<string> = [];
    let text = render([], { hasMore: sampleLines.length > startIndex });

    for (let index = startIndex; index < sampleLines.length; index += 1) {
        const candidateLines = [...lines, sampleLines[index]];
        const candidateText = render(candidateLines, { hasMore: index + 1 < sampleLines.length });
        if (candidateText.length > safeMaxChars) {
            break;
        }
        lines.push(sampleLines[index]);
        text = candidateText;
    }

    if (lines.length === 0 && startIndex < sampleLines.length) {
        const firstLine = sampleLines[startIndex];
        const clipped = clipLineToRenderedBudget(firstLine, safeMaxChars, (candidate) =>
            render([candidate], { hasMore: startIndex + 1 < sampleLines.length }),
        );
        return {
            lines: [clipped],
            nextIndex: startIndex + 1,
            text: render([clipped], { hasMore: startIndex + 1 < sampleLines.length }),
        };
    }

    return {
        lines,
        nextIndex: startIndex + lines.length,
        text,
    };
};

const clipLineToRenderedBudget = (
    line: string,
    maxChars: number,
    render: (line: string) => string,
): string => {
    if (render(line).length <= maxChars) {
        return line;
    }

    let low = 0;
    let high = line.length;
    let best = '...';
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = mid >= line.length ? line : `${line.slice(0, Math.max(0, mid)).trimEnd()}...`;
        if (render(candidate).length <= maxChars) {
            best = candidate;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return best;
};

const resolveRoomContext = async (
    read: IRead,
    interactionRoom: IUIKitBlockIncomingInteraction['room'],
    payloadRoomId: string,
): Promise<IUIKitBlockIncomingInteraction['room']> => {
    if (interactionRoom) {
        return interactionRoom;
    }

    try {
        return await read.getRoomReader().getById(payloadRoomId);
    } catch {
        return undefined;
    }
};

const resolveActionPayloadForActor = async (
    read: IRead,
    actorId: string,
    payload: SlashCardActionPayload,
): Promise<SlashCardActionPayload | undefined> => {
    if (!payload.snapshotId) {
        return payload.sampleOutput.length > 0 || payload.sampleTotalCount === 0 ? payload : undefined;
    }

    try {
        const snapshot = await readSlashCardSampleSnapshot(read, actorId, payload.snapshotId);
        if (!snapshot) {
            // Snapshot-backed cards intentionally fail closed once the server-side copy expires.
            return undefined;
        }

        return {
            ...payload,
            roomId: snapshot.roomId,
            roomName: snapshot.roomName,
            threadId: snapshot.threadId,
            sourceMode: snapshot.sourceMode,
            windowLabel: snapshot.windowLabel,
            filterSummary: snapshot.filterSummary,
            preset: snapshot.preset,
            sampleOutput: snapshot.sampleOutput,
            sampleTotalCount: snapshot.sampleTotalCount,
        };
    } catch {
        return undefined;
    }
};

const getSampleStats = (
    payload: SlashCardActionPayload,
    displayedCount: number,
    truncatedByBudget: boolean = false,
): { displayedCount: number; totalCount: number; truncated: boolean } => {
    const totalCount = Math.max(displayedCount, payload.sampleTotalCount || payload.sampleOutput.length || displayedCount);
    return {
        displayedCount,
        totalCount,
        truncated: truncatedByBudget || totalCount > displayedCount,
    };
};

const readPublishedMessageId = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate.id === 'string' && candidate.id.trim()) {
        return candidate.id.trim();
    }
    if (typeof candidate._id === 'string' && candidate._id.trim()) {
        return candidate._id.trim();
    }

    return undefined;
};

const formatShareOutcomeMessage = (
    result: ShareRenderResult,
    target: string,
): string => {
    const pageSuffix = result.pageCount > 1 ? ` across ${result.pageCount} message(s)` : '';
    const truncationSuffix = result.partialPublish
        ? ' Some sampled lines were omitted because a later page could not be posted.'
        : result.truncated
            ? ' Some sampled lines were omitted after paging limits.'
            : '';
    return `Shared ${result.displayedCount} of ${result.totalCount} sampled line(s)${pageSuffix} to ${target}.${truncationSuffix}`;
};
