import { HttpStatusCode, IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';
import { IMessageRaw } from '@rocket.chat/apps-engine/definition/messages';

import { SETTINGS } from '../../constants';
import { authorizeRequestUser, parseWorkspacePermissionCode, parseWorkspacePermissionMode } from '../../security/accessControl';
import { parseAllowedRoles } from '../../security/querySecurity';
import { parseThreadsQuery } from './threadsValidation';

type ThreadTarget = {
    id: string;
    preview: string;
    createdAt: string | null;
    lastActivityAt: string | null;
    sampleReplyCount: number;
};

type ThreadActivity = {
    lastActivityMs: number;
    sampleReplyCount: number;
};

const MAX_MESSAGE_SCAN = 100;
const MAX_THREAD_SCAN = 300;
const PREVIEW_MAX = 180;

export class LogsThreadsEndpoint extends ApiEndpoint {
    public path = 'threads';
    public authRequired = true;

    public async get(
        request: IApiRequest,
        _endpoint: IApiEndpointInfo,
        read: IRead,
        _modify: IModify,
        http: IHttp,
        _persistence: IPersistence,
    ): Promise<IApiResponse> {
        if (!request.user) {
            return this.json({
                status: HttpStatusCode.UNAUTHORIZED,
                content: { ok: false, error: 'Authentication required.' },
            });
        }

        const settingsReader = read.getEnvironmentReader().getSettings();
        const [allowedRolesRaw, workspacePermissionCodeRaw, workspacePermissionModeRaw] = await Promise.all([
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
        ]);

        const decision = await authorizeRequestUser({
            request,
            read,
            http,
            allowedRoles: parseAllowedRoles(allowedRolesRaw),
            workspacePermissionCode: parseWorkspacePermissionCode(workspacePermissionCodeRaw),
            workspacePermissionMode: parseWorkspacePermissionMode(workspacePermissionModeRaw),
        });
        if (!decision.allowed) {
            return this.json({
                status: HttpStatusCode.FORBIDDEN,
                content: {
                    ok: false,
                    error: 'Insufficient authorization for logs threads access.',
                    reason: decision.reason,
                },
            });
        }

        const parsed = parseThreadsQuery((request.query || {}) as Record<string, unknown>, {
            defaultLimit: 40,
            maxLimit: 100,
            maxSearchLength: 80,
            maxRoomIdLength: 128,
        });
        if ('error' in parsed) {
            return this.json({
                status: HttpStatusCode.BAD_REQUEST,
                content: {
                    ok: false,
                    error: parsed.error,
                },
            });
        }

        const room = await read.getRoomReader().getById(parsed.query.roomId);
        if (!room) {
            return this.json({
                status: HttpStatusCode.BAD_REQUEST,
                content: {
                    ok: false,
                    error: 'Target room does not exist.',
                },
            });
        }

        const userRoomIds = await read.getUserReader().getUserRoomIds(request.user.id);
        if (!Array.isArray(userRoomIds) || !userRoomIds.includes(room.id)) {
            return this.json({
                status: HttpStatusCode.FORBIDDEN,
                content: {
                    ok: false,
                    error: 'User does not have access to target room.',
                    reason: 'forbidden_room_access',
                },
            });
        }

        // Apps-Engine room reader enforces a max message fetch size of 100.
        const scanLimit = Math.min(MAX_MESSAGE_SCAN, Math.max(40, parsed.query.limit * 4));
        const recentMessages = await read.getRoomReader().getMessages(parsed.query.roomId, {
            limit: scanLimit,
            skip: 0,
            sort: { createdAt: 'desc' },
            showThreadMessages: true,
        });

        const activity = this.buildThreadActivityMap(recentMessages);
        const threadIds = [...activity.keys()].slice(0, MAX_THREAD_SCAN);
        const threadTargets = await this.hydrateThreads(read, parsed.query.roomId, threadIds, activity);
        const filtered = this.filterThreads(threadTargets, parsed.query.search);
        const sorted = filtered.sort((a, b) => this.compareThreadTargets(a, b));
        const limited = sorted.slice(0, parsed.query.limit);

        return this.success({
            ok: true,
            threads: {
                items: limited,
                meta: {
                    roomId: parsed.query.roomId,
                    total: sorted.length,
                    returned: limited.length,
                    limit: parsed.query.limit,
                    search: parsed.query.search || null,
                },
            },
        });
    }

    private buildThreadActivityMap(messages: Array<IMessageRaw>): Map<string, ThreadActivity> {
        const activity = new Map<string, ThreadActivity>();
        for (const message of messages) {
            const threadId = message.threadId;
            if (!threadId) {
                continue;
            }

            const ts = this.dateToMs(message.createdAt);
            const existing = activity.get(threadId);
            if (!existing) {
                activity.set(threadId, {
                    lastActivityMs: ts,
                    sampleReplyCount: 1,
                });
                continue;
            }

            existing.lastActivityMs = Math.max(existing.lastActivityMs, ts);
            existing.sampleReplyCount += 1;
        }

        return activity;
    }

    private async hydrateThreads(
        read: IRead,
        roomId: string,
        threadIds: Array<string>,
        activity: Map<string, ThreadActivity>,
    ): Promise<Array<ThreadTarget>> {
        const targets: Array<ThreadTarget> = [];

        for (const threadId of threadIds) {
            const root = await read.getMessageReader().getById(threadId);
            if (!root) {
                continue;
            }

            const rootRoom = await read.getMessageReader().getRoom(threadId);
            if (!rootRoom || rootRoom.id !== roomId) {
                continue;
            }

            const activityRecord = activity.get(threadId);
            const createdAtMs = this.dateToMs(root.createdAt);
            const updatedAtMs = this.dateToMs(root.updatedAt);
            const lastActivityMs = Math.max(activityRecord?.lastActivityMs || 0, createdAtMs, updatedAtMs);

            targets.push({
                id: threadId,
                preview: this.buildPreview(root.text),
                createdAt: this.msToIso(createdAtMs),
                lastActivityAt: this.msToIso(lastActivityMs),
                sampleReplyCount: activityRecord?.sampleReplyCount || 0,
            });
        }

        return targets;
    }

    private filterThreads(threads: Array<ThreadTarget>, search?: string): Array<ThreadTarget> {
        if (!search) {
            return threads;
        }

        const needle = search.toLowerCase();
        return threads.filter((thread) => thread.id.toLowerCase().includes(needle) || thread.preview.toLowerCase().includes(needle));
    }

    private compareThreadTargets(a: ThreadTarget, b: ThreadTarget): number {
        const aActivity = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
        const bActivity = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
        if (aActivity !== bActivity) {
            return bActivity - aActivity;
        }

        const aCreated = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bCreated = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bCreated - aCreated;
    }

    private buildPreview(text?: string): string {
        const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
        if (!normalized) {
            return '[no text]';
        }

        return normalized.slice(0, PREVIEW_MAX);
    }

    private dateToMs(value?: Date): number {
        if (!value) {
            return 0;
        }

        const parsed = value.getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private msToIso(value: number): string | null {
        if (!value || value <= 0) {
            return null;
        }

        return new Date(value).toISOString();
    }
}
