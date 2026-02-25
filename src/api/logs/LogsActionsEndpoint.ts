import { HttpStatusCode, IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';

import { SETTINGS } from '../../constants';
import { authorizeRequestUser, parseWorkspacePermissionCode, parseWorkspacePermissionMode, WorkspacePermissionMode } from '../../security/accessControl';
import { appendAuditEntry, consumeRateLimitToken, parseAllowedRoles } from '../../security/querySecurity';
import { composeActionMessage, LogsActionType, parseAndNormalizeLogActionRequest } from './actionValidation';

type SecuritySettings = {
    allowedRoles: Array<string>;
    workspacePermissionCode: string;
    workspacePermissionMode: WorkspacePermissionMode;
    rateLimitQpm: number;
    auditRetentionDays: number;
    auditMaxEntries: number;
};

export class LogsActionsEndpoint extends ApiEndpoint {
    public path = 'actions';
    public authRequired = true;

    public async post(
        request: IApiRequest,
        _endpoint: IApiEndpointInfo,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persistence: IPersistence,
    ): Promise<IApiResponse> {
        if (!request.user) {
            return this.json({
                status: HttpStatusCode.UNAUTHORIZED,
                content: { ok: false, error: 'Authentication required.' },
            });
        }

        const requestedAction = this.readRequestedAction(request.content);

        const settingsReader = read.getEnvironmentReader().getSettings();
        const [allowedRolesRaw, workspacePermissionCodeRaw, workspacePermissionModeRaw, rateLimitQpmRaw, auditRetentionDaysRaw, auditMaxEntriesRaw] =
            await Promise.all([
                settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
                settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
                settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
                settingsReader.getValueById(SETTINGS.RATE_LIMIT_QPM),
                settingsReader.getValueById(SETTINGS.AUDIT_RETENTION_DAYS),
                settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
            ]);

        const security: SecuritySettings = {
            allowedRoles: parseAllowedRoles(allowedRolesRaw),
            workspacePermissionCode: parseWorkspacePermissionCode(workspacePermissionCodeRaw),
            workspacePermissionMode: parseWorkspacePermissionMode(workspacePermissionModeRaw),
            rateLimitQpm: this.readNumberSetting(rateLimitQpmRaw, 60, 1, 1000),
            auditRetentionDays: this.readNumberSetting(auditRetentionDaysRaw, 90, 1, 365),
            auditMaxEntries: this.readNumberSetting(auditMaxEntriesRaw, 5000, 100, 20000),
        };

        const accessDecision = await authorizeRequestUser({
            request,
            read,
            http,
            allowedRoles: security.allowedRoles,
            workspacePermissionCode: security.workspacePermissionCode,
            workspacePermissionMode: security.workspacePermissionMode,
        });
        if (!accessDecision.allowed) {
            await this.audit(
                read,
                persistence,
                {
                    action: this.deniedActionFor(requestedAction),
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: accessDecision.reason || 'forbidden_role',
                    scope: {
                        requiredRoles: security.allowedRoles,
                        workspacePermissionCode: security.workspacePermissionCode,
                        workspacePermissionMode: security.workspacePermissionMode,
                        details: accessDecision.details,
                    },
                },
                security,
            );

            return this.json({
                status: HttpStatusCode.FORBIDDEN,
                content: {
                    ok: false,
                    error: 'Insufficient authorization for logs actions.',
                    reason: accessDecision.reason || 'forbidden_role',
                },
            });
        }

        const rateLimit = await consumeRateLimitToken(read, persistence, `action:${request.user.id}`, security.rateLimitQpm);
        if (!rateLimit.allowed) {
            await this.audit(
                read,
                persistence,
                {
                    action: this.deniedActionFor(requestedAction),
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: 'rate_limited',
                    scope: {
                        retryAfterSeconds: rateLimit.retryAfterSeconds,
                        rateLimitQpm: security.rateLimitQpm,
                    },
                },
                security,
            );

            return this.json({
                status: HttpStatusCode.TOO_MANY_REQUESTS,
                headers: {
                    'retry-after': String(rateLimit.retryAfterSeconds || 1),
                },
                content: {
                    ok: false,
                    error: 'Rate limit exceeded for logs actions.',
                    retryAfterSeconds: rateLimit.retryAfterSeconds || 1,
                },
            });
        }

        const parsed = parseAndNormalizeLogActionRequest(request.content);
        if ('error' in parsed) {
            await this.audit(
                read,
                persistence,
                {
                    action: this.deniedActionFor(requestedAction),
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: 'invalid_action_payload',
                    scope: {
                        details: parsed.details,
                    },
                },
                security,
            );
            return this.badRequest(parsed.error, parsed.details);
        }

        // Thread notes are explicitly tied to an existing thread target.
        if (parsed.request.action === 'thread_note' && !parsed.request.targetThreadId) {
            await this.audit(
                read,
                persistence,
                {
                    action: 'thread_note_denied',
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: 'thread_id_required',
                },
                security,
            );
            return this.badRequest('targetThreadId is required for thread_note action.');
        }

        const room = await read.getRoomReader().getById(parsed.request.targetRoomId);
        if (!room) {
            await this.audit(
                read,
                persistence,
                {
                    action: this.deniedActionFor(parsed.request.action),
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: 'invalid_target_room',
                    scope: { targetRoomId: parsed.request.targetRoomId },
                },
                security,
            );
            return this.badRequest('Target room does not exist.');
        }

        const userRoomIds = await read.getUserReader().getUserRoomIds(request.user.id);
        if (!Array.isArray(userRoomIds) || !userRoomIds.includes(room.id)) {
            await this.audit(
                read,
                persistence,
                {
                    action: this.deniedActionFor(parsed.request.action),
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: 'forbidden_room_access',
                    scope: { targetRoomId: parsed.request.targetRoomId },
                },
                security,
            );
            return this.json({
                status: HttpStatusCode.FORBIDDEN,
                content: {
                    ok: false,
                    error: 'User does not have access to target room.',
                    reason: 'forbidden_room_access',
                },
            });
        }

        if (parsed.request.targetThreadId) {
            const validThread = await this.validateThread(read, parsed.request.targetThreadId, room.id);
            if (!validThread) {
                await this.audit(
                    read,
                    persistence,
                    {
                        action: this.deniedActionFor(parsed.request.action),
                        userId: request.user.id,
                        outcome: 'denied',
                        reason: 'invalid_target_thread',
                        scope: {
                            targetRoomId: parsed.request.targetRoomId,
                            targetThreadId: parsed.request.targetThreadId,
                        },
                    },
                    security,
                );
                return this.badRequest('Target thread does not exist in target room.');
            }
        }

        const appUser = await read.getUserReader().getAppUser(this.app.getID());
        if (!appUser) {
            return this.json({
                status: HttpStatusCode.INTERNAL_SERVER_ERROR,
                content: {
                    ok: false,
                    error: 'App user is unavailable; cannot post logs action message.',
                },
            });
        }

        const messageBuilder = modify.getCreator().startMessage();
        messageBuilder.setRoom(room);
        messageBuilder.setSender(appUser);
        messageBuilder.setGroupable(false);
        messageBuilder.setParseUrls(false);
        messageBuilder.setText(composeActionMessage(parsed.request));
        if (parsed.request.targetThreadId) {
            messageBuilder.setThreadId(parsed.request.targetThreadId);
        }

        const messageId = await modify.getCreator().finish(messageBuilder);

        await this.audit(
            read,
            persistence,
            {
                action: parsed.request.action,
                userId: request.user.id,
                outcome: 'allowed',
                scope: {
                    targetRoomId: parsed.request.targetRoomId,
                    targetThreadId: parsed.request.targetThreadId || null,
                    postedMessageId: messageId,
                    level: parsed.request.entry.level,
                },
            },
            security,
        );

        return this.success({
            ok: true,
            action: parsed.request.action,
            postedMessageId: messageId,
            target: {
                roomId: parsed.request.targetRoomId,
                threadId: parsed.request.targetThreadId || null,
            },
        });
    }

    private readRequestedAction(content: unknown): LogsActionType {
        const raw = content as { action?: unknown };
        if (raw && raw.action === 'incident_draft') {
            return 'incident_draft';
        }
        if (raw && raw.action === 'thread_note') {
            return 'thread_note';
        }
        return 'share';
    }

    private deniedActionFor(action: LogsActionType): 'share_denied' | 'incident_draft_denied' | 'thread_note_denied' {
        if (action === 'incident_draft') {
            return 'incident_draft_denied';
        }
        if (action === 'thread_note') {
            return 'thread_note_denied';
        }
        return 'share_denied';
    }

    private async validateThread(read: IRead, threadId: string, roomId: string): Promise<boolean> {
        const threadMessage = await read.getMessageReader().getById(threadId);
        if (!threadMessage) {
            return false;
        }

        const threadRoom = await read.getMessageReader().getRoom(threadId);
        if (!threadRoom) {
            return false;
        }

        return threadRoom.id === roomId;
    }

    private readNumberSetting(value: unknown, fallback: number, min: number, max: number): number {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, Math.floor(parsed)));
    }

    private badRequest(message: string, details?: unknown): IApiResponse {
        return this.json({
            status: HttpStatusCode.BAD_REQUEST,
            content: {
                ok: false,
                error: message,
                details,
            },
        });
    }

    private async audit(
        read: IRead,
        persistence: IPersistence,
        entry: {
            action: 'share' | 'share_denied' | 'incident_draft' | 'incident_draft_denied' | 'thread_note' | 'thread_note_denied';
            userId: string;
            outcome: 'allowed' | 'denied';
            reason?: string;
            scope?: Record<string, unknown>;
        },
        security: SecuritySettings,
    ): Promise<void> {
        try {
            await appendAuditEntry(read, persistence, entry, security.auditRetentionDays, security.auditMaxEntries);
        } catch {
            // Audit failures should never block action workflows.
        }
    }
}
