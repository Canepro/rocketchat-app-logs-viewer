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
const COPY_OUTPUT_MAX_LINES = 40;
const SHARE_OUTPUT_MAX_LINES = 40;
const SAMPLE_RENDER_MODE = 'full_line_priority';
const DEFAULT_MESSAGE_MAX_ALLOWED_SIZE = 5000;
const MESSAGE_SIZE_MIN = 1200;
const MESSAGE_SIZE_MAX = 12000;
const MESSAGE_SIZE_SAFETY_RATIO = 0.7;
const MESSAGE_OVERHEAD_BUFFER = 420;
const SHARE_ELSEWHERE_MODAL_ID_PREFIX = 'logs_slash_share_elsewhere_modal:';
const SHARE_ELSEWHERE_BLOCK_ID = 'share_elsewhere_target_room';
const SHARE_ELSEWHERE_ACTION_ID = 'share_elsewhere_target_room_input';
const SHARE_ELSEWHERE_THREAD_BLOCK_ID = 'share_elsewhere_target_thread';
const SHARE_ELSEWHERE_THREAD_ACTION_ID = 'share_elsewhere_target_thread_input';

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
    const messageBudgetChars = Math.max(
        MESSAGE_SIZE_MIN,
        Math.min(MESSAGE_SIZE_MAX, Math.floor(messageMaxAllowedSize * MESSAGE_SIZE_SAFETY_RATIO)),
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
            buildCopyResponseLines(resolvedPayload, messageBudgetChars),
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
        messageBudgetChars,
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
    const messageBudgetChars = Math.max(
        MESSAGE_SIZE_MIN,
        Math.min(MESSAGE_SIZE_MAX, Math.floor(messageMaxAllowedSize * MESSAGE_SIZE_SAFETY_RATIO)),
    );

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

    const sampleLines = formatSampleLines(resolvedPayload, { withIndex: true, maxLines: SHARE_OUTPUT_MAX_LINES });
    const boundedSample = fitSampleLinesToCharBudget(sampleLines, Math.max(160, messageBudgetChars - MESSAGE_OVERHEAD_BUFFER));
    const sampleStats = getSampleStats(resolvedPayload, boundedSample.lines.length, boundedSample.truncated);
    const shareText = buildShareMessage(resolvedPayload, boundedSample.lines, sampleStats);

    const usedThreadId = await publishShareMessageWithFallback(modify, appUser, targetRoom, targetThreadId, shareText);
    if (usedThreadId === null) {
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
                threadId: usedThreadId || null,
                sampleCount: sampleStats.displayedCount,
                sampleTotalCount: sampleStats.totalCount,
            },
        },
        auditRetentionDays,
        auditMaxEntries,
    );
    await notifyUserOnly(actor, targetRoom, appUser, modify, [
        `Shared ${sampleStats.displayedCount} of ${sampleStats.totalCount} sampled line(s) to ${usedThreadId ? 'thread' : 'room'} in "${targetRoom.displayName || targetRoom.slugifiedName}".`,
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
    messageBudgetChars: number,
): Promise<void> => {
    if (!roomContext) {
        await notifyUserOnly(actor, roomContext, appUser, modify, [
            'Cannot share sample because room context is not available.',
        ]);
        return;
    }

    const roomId = roomContext.id || payload.roomId;
    const threadId = payload.threadId || interactionThreadId || undefined;
    const sampleLines = formatSampleLines(payload, { withIndex: true, maxLines: SHARE_OUTPUT_MAX_LINES });
    const boundedSample = fitSampleLinesToCharBudget(sampleLines, Math.max(160, messageBudgetChars - MESSAGE_OVERHEAD_BUFFER));
    const sampleStats = getSampleStats(payload, boundedSample.lines.length, boundedSample.truncated);
    const shareText = buildShareMessage(payload, boundedSample.lines, sampleStats);

    const usedThreadId = await publishShareMessageWithFallback(modify, appUser, roomContext, threadId, shareText);
    if (usedThreadId === null) {
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
                threadId: usedThreadId || null,
                sampleCount: sampleStats.displayedCount,
                sampleTotalCount: sampleStats.totalCount,
            },
        },
        auditRetentionDays,
        auditMaxEntries,
    );

    await notifyUserOnly(actor, roomContext, appUser, modify, [
        `Shared ${sampleStats.displayedCount} of ${sampleStats.totalCount} sampled line(s) to ${usedThreadId ? 'thread' : 'room'} successfully.`,
    ]);
};

const buildCopyResponseLines = (payload: SlashCardActionPayload, messageBudgetChars: number): Array<string> => {
    const sampleLines = formatSampleLines(payload, { withIndex: true, maxLines: COPY_OUTPUT_MAX_LINES });
    const boundedSample = fitSampleLinesToCharBudget(sampleLines, Math.max(160, messageBudgetChars - MESSAGE_OVERHEAD_BUFFER));
    const sampleStats = getSampleStats(payload, boundedSample.lines.length, boundedSample.truncated);
    if (boundedSample.lines.length === 0) {
        return [
            'Copy-ready sample is unavailable for this result.',
            'Run query in Logs Viewer, then use Share sample if you need room-visible evidence.',
        ];
    }

    return [
        'Copy-ready sample (private):',
        'Clipboard note: this action cannot write to your local clipboard. Copy from the block below.',
        `Render mode: ${SAMPLE_RENDER_MODE} (fewer lines, richer line text).`,
        // Provide a code block so operators can paste exact lines into tickets/incidents.
        `${CODE_FENCE}\n${toCodeBlock(boundedSample.lines.join('\n'))}\n${CODE_FENCE}`,
        `Lines=${sampleStats.displayedCount}/${sampleStats.totalCount} Source=${payload.sourceMode} Window=${payload.windowLabel} Filters=${payload.filterSummary}`,
        sampleStats.truncated ? 'Sample output was truncated for chat readability. Use Open Logs Viewer for full result.' : '',
    ];
};

const buildShareMessage = (
    payload: SlashCardActionPayload,
    sampleLines: Array<string>,
    sampleStats: { displayedCount: number; totalCount: number; truncated: boolean },
): string => {
    const lines = [
        '*Logs sample shared from `/logs`*',
        `Source: \`${payload.sourceMode}\``,
        `Window: ${payload.windowLabel}`,
        `Filters: ${payload.filterSummary}`,
        `Preset: ${payload.preset}`,
        `Render mode: ${SAMPLE_RENDER_MODE}`,
        `Lines: ${sampleStats.displayedCount}/${sampleStats.totalCount}`,
    ];

    if (sampleLines.length === 0) {
        lines.push('No sampled lines were available in this slash response.');
        return lines.join('\n');
    }

    lines.push('Sample output:');
    lines.push(CODE_FENCE);
    lines.push(toCodeBlock(sampleLines.join('\n')));
    lines.push(CODE_FENCE);
    if (sampleStats.truncated) {
        lines.push('Sample output was truncated for chat readability. Use Open Logs Viewer for full result.');
    }

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

const toCodeBlock = (value: string): string => value.replace(/```/g, "'''");

const publishShareMessageWithFallback = async (
    modify: IModify,
    appUser: IUser,
    roomContext: IUIKitBlockIncomingInteraction['room'],
    threadId: string | undefined,
    text: string,
): Promise<string | undefined | null> => {
    if (!roomContext) {
        return null;
    }

    try {
        await publishShareMessage(modify, appUser, roomContext, threadId, text);
        return threadId;
    } catch {
        if (!threadId) {
            return null;
        }

        // Thread IDs can become invalid after deletes/permissions changes; retry in room timeline.
        try {
            await publishShareMessage(modify, appUser, roomContext, undefined, text);
            return undefined;
        } catch {
            return null;
        }
    }
};

const publishShareMessage = async (
    modify: IModify,
    appUser: IUser,
    roomContext: NonNullable<IUIKitBlockIncomingInteraction['room']>,
    threadId: string | undefined,
    text: string,
): Promise<void> => {
    const messageBuilder = modify.getCreator().startMessage();
    messageBuilder.setSender(appUser);
    messageBuilder.setRoom(roomContext);
    messageBuilder.setGroupable(false);
    messageBuilder.setParseUrls(false);
    if (threadId) {
        messageBuilder.setThreadId(threadId);
    }
    messageBuilder.setText(text);

    await modify.getCreator().finish(messageBuilder);
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

const fitSampleLinesToCharBudget = (
    sampleLines: Array<string>,
    maxChars: number,
): { lines: Array<string>; truncated: boolean } => {
    const safeMaxChars = Math.max(80, Math.floor(maxChars));
    const lines: Array<string> = [];
    let usedChars = 0;

    for (const line of sampleLines) {
        const nextChars = usedChars + line.length + 1;
        if (nextChars > safeMaxChars) {
            break;
        }
        lines.push(line);
        usedChars = nextChars;
    }

    if (lines.length === 0 && sampleLines.length > 0) {
        const firstLine = sampleLines[0];
        const clipped = firstLine.length > safeMaxChars ? `${firstLine.slice(0, safeMaxChars - 3)}...` : firstLine;
        return {
            lines: [clipped],
            truncated: sampleLines.length > 1 || clipped.length < firstLine.length,
        };
    }

    return {
        lines,
        truncated: sampleLines.length > lines.length,
    };
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
            return payload.sampleOutput.length > 0 ? payload : undefined;
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
        return payload.sampleOutput.length > 0 ? payload : undefined;
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
