import { IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IUIKitBlockIncomingInteraction } from '@rocket.chat/apps-engine/definition/uikit/UIKitIncomingInteractionTypes';
import { IUser } from '@rocket.chat/apps-engine/definition/users';

import { SETTINGS } from '../constants';
import { appendAuditEntry, hasAnyAllowedRole, parseAllowedRoles } from '../security/querySecurity';
import {
    decodeSlashCardActionPayload,
    formatSampleLines,
    isSlashCardActionId,
    SLASH_CARD_ACTION,
    SlashCardActionPayload,
} from './slashCardActions';
import { readSlashCardSampleSnapshot } from './slashCardSampleStore';

const CODE_FENCE = '```';
const COPY_OUTPUT_MAX_LINES = 60;
const SHARE_OUTPUT_MAX_LINES = 60;

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
    const [allowedRolesRaw, retentionDaysRaw, maxEntriesRaw] = await Promise.all([
        settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
        settingsReader.getValueById(SETTINGS.AUDIT_RETENTION_DAYS),
        settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
    ]);
    const allowedRoles = parseAllowedRoles(allowedRolesRaw);
    const auditRetentionDays = readNumber(retentionDaysRaw, 7, 1, 90);
    const auditMaxEntries = readNumber(maxEntriesRaw, 2000, 100, 10000);

    if (!hasAnyAllowedRole(actor.roles, allowedRoles)) {
        // Re-check authorization at click time so role changes are honored immediately.
        if (interaction.actionId === SLASH_CARD_ACTION.SHARE_SAMPLE) {
            await appendAuditEntry(
                read,
                persistence,
                {
                    action: 'share_denied',
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
        await notifyUserOnly(actor, roomContext, appUser, modify, buildCopyResponseLines(resolvedPayload));
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
    );
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
    const sampleStats = getSampleStats(payload, sampleLines.length);

    const messageBuilder = modify.getCreator().startMessage();
    messageBuilder.setSender(appUser);
    messageBuilder.setRoom(roomContext);
    messageBuilder.setGroupable(false);
    messageBuilder.setParseUrls(false);
    if (threadId) {
        // Preserve slash thread context when available for incident timelines.
        messageBuilder.setThreadId(threadId);
    }
    messageBuilder.setText(buildShareMessage(payload, sampleLines, sampleStats));
    await modify.getCreator().finish(messageBuilder);

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
                threadId: threadId || null,
                sampleCount: sampleStats.displayedCount,
                sampleTotalCount: sampleStats.totalCount,
            },
        },
        auditRetentionDays,
        auditMaxEntries,
    );

    await notifyUserOnly(actor, roomContext, appUser, modify, [
        `Shared ${sampleStats.displayedCount} of ${sampleStats.totalCount} sampled line(s) to ${threadId ? 'thread' : 'room'} successfully.`,
    ]);
};

const buildCopyResponseLines = (payload: SlashCardActionPayload): Array<string> => {
    const sampleLines = formatSampleLines(payload, { withIndex: true, maxLines: COPY_OUTPUT_MAX_LINES });
    const sampleStats = getSampleStats(payload, sampleLines.length);
    if (sampleLines.length === 0) {
        return [
            'Copy-ready sample is unavailable for this result.',
            'Run query in Logs Viewer, then use Share sample if you need room-visible evidence.',
        ];
    }

    return [
        'Copy-ready sample (private):',
        // Provide a code block so operators can paste exact lines into tickets/incidents.
        `${CODE_FENCE}\n${toCodeBlock(sampleLines.join('\n'))}\n${CODE_FENCE}`,
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

const readNumber = (value: unknown, defaultValue: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }

    return Math.min(max, Math.max(min, Math.floor(parsed)));
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
): { displayedCount: number; totalCount: number; truncated: boolean } => {
    const totalCount = Math.max(displayedCount, payload.sampleTotalCount || payload.sampleOutput.length || displayedCount);
    return {
        displayedCount,
        totalCount,
        truncated: totalCount > displayedCount,
    };
};
