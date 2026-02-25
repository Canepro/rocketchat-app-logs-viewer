import { HttpStatusCode, IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

import { SETTINGS } from '../../constants';
import { authorizeRequestUser, parseWorkspacePermissionCode, parseWorkspacePermissionMode } from '../../security/accessControl';
import { appendAuditEntry, parseAllowedRoles } from '../../security/querySecurity';
import { SavedViewQuery, parseSavedViewsListQuery, parseSavedViewsMutation } from './viewsValidation';

type SavedView = {
    id: string;
    userId: string;
    name: string;
    query: SavedViewQuery;
    createdAt: string;
    updatedAt: string;
};

type SavedViewsRecord = {
    updatedAt: string;
    views: Array<SavedView>;
};

const MAX_VIEWS_PER_USER = 50;

export class LogsViewsEndpoint extends ApiEndpoint {
    public path = 'views';
    public authRequired = true;

    public async get(
        request: IApiRequest,
        _endpoint: IApiEndpointInfo,
        read: IRead,
        _modify: IModify,
        http: IHttp,
        persistence: IPersistence,
    ): Promise<IApiResponse> {
        if (!request.user) {
            return this.json({
                status: HttpStatusCode.UNAUTHORIZED,
                content: { ok: false, error: 'Authentication required.' },
            });
        }

        const settingsReader = read.getEnvironmentReader().getSettings();
        const [allowedRolesRaw, workspacePermissionCodeRaw, workspacePermissionModeRaw, auditRetentionDaysRaw, auditMaxEntriesRaw] = await Promise.all([
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
            settingsReader.getValueById(SETTINGS.AUDIT_RETENTION_DAYS),
            settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
        ]);

        const security = {
            allowedRoles: parseAllowedRoles(allowedRolesRaw),
            workspacePermissionCode: parseWorkspacePermissionCode(workspacePermissionCodeRaw),
            workspacePermissionMode: parseWorkspacePermissionMode(workspacePermissionModeRaw),
            auditRetentionDays: this.readNumber(auditRetentionDaysRaw, 90, 1, 365),
            auditMaxEntries: this.readNumber(auditMaxEntriesRaw, 5000, 100, 20000),
        };

        const access = await authorizeRequestUser({
            request,
            read,
            http,
            allowedRoles: security.allowedRoles,
            workspacePermissionCode: security.workspacePermissionCode,
            workspacePermissionMode: security.workspacePermissionMode,
        });
        if (!access.allowed) {
            await this.audit(read, persistence, {
                action: 'saved_view_list_denied',
                userId: request.user.id,
                outcome: 'denied',
                reason: access.reason || 'forbidden_role',
            }, security);

            return this.json({
                status: HttpStatusCode.FORBIDDEN,
                content: {
                    ok: false,
                    error: 'Insufficient authorization for saved views.',
                    reason: access.reason || 'forbidden_role',
                },
            });
        }

        const parsedList = parseSavedViewsListQuery((request.query || {}) as Record<string, unknown>, {
            defaultLimit: MAX_VIEWS_PER_USER,
            maxLimit: MAX_VIEWS_PER_USER,
        });
        const allViews = await this.readViews(read, request.user.id);
        const sorted = [...allViews].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        const limited = sorted.slice(0, parsedList.limit).map((view) => this.toPublicView(view));

        await this.audit(
            read,
            persistence,
            {
                action: 'saved_view_list',
                userId: request.user.id,
                outcome: 'allowed',
                scope: {
                    total: sorted.length,
                    returned: limited.length,
                },
            },
            security,
        );

        return this.success({
            ok: true,
            views: {
                items: limited,
                meta: {
                    total: sorted.length,
                    returned: limited.length,
                    limit: parsedList.limit,
                },
            },
        });
    }

    public async post(
        request: IApiRequest,
        _endpoint: IApiEndpointInfo,
        read: IRead,
        _modify: IModify,
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
        const [allowedRolesRaw, workspacePermissionCodeRaw, workspacePermissionModeRaw, auditRetentionDaysRaw, auditMaxEntriesRaw] = await Promise.all([
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
            settingsReader.getValueById(SETTINGS.AUDIT_RETENTION_DAYS),
            settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
        ]);

        const security = {
            allowedRoles: parseAllowedRoles(allowedRolesRaw),
            workspacePermissionCode: parseWorkspacePermissionCode(workspacePermissionCodeRaw),
            workspacePermissionMode: parseWorkspacePermissionMode(workspacePermissionModeRaw),
            auditRetentionDays: this.readNumber(auditRetentionDaysRaw, 90, 1, 365),
            auditMaxEntries: this.readNumber(auditMaxEntriesRaw, 5000, 100, 20000),
        };

        const access = await authorizeRequestUser({
            request,
            read,
            http,
            allowedRoles: security.allowedRoles,
            workspacePermissionCode: security.workspacePermissionCode,
            workspacePermissionMode: security.workspacePermissionMode,
        });
        if (!access.allowed) {
            await this.audit(read, persistence, {
                action: this.deniedActionFor(requestedAction),
                userId: request.user.id,
                outcome: 'denied',
                reason: access.reason || 'forbidden_role',
            }, security);

            return this.json({
                status: HttpStatusCode.FORBIDDEN,
                content: {
                    ok: false,
                    error: 'Insufficient authorization for saved views.',
                    reason: access.reason || 'forbidden_role',
                },
            });
        }

        const parsed = parseSavedViewsMutation(request.content);
        if ('error' in parsed) {
            await this.audit(
                read,
                persistence,
                {
                    action: this.deniedActionFor(requestedAction),
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: 'invalid_saved_view_payload',
                    scope: {
                        details: parsed.details,
                    },
                },
                security,
            );

            return this.badRequest(parsed.error, parsed.details);
        }

        const mutation = parsed.mutation;
        const now = new Date().toISOString();
        const views = await this.readViews(read, request.user.id);

        if (mutation.action === 'create') {
            if (views.length >= MAX_VIEWS_PER_USER) {
                return this.badRequest(`Saved views limit reached (${MAX_VIEWS_PER_USER}).`);
            }

            const nextView: SavedView = {
                id: this.generateViewId(),
                userId: request.user.id,
                name: mutation.name,
                query: mutation.query,
                createdAt: now,
                updatedAt: now,
            };

            const nextViews = [nextView, ...views];
            await this.writeViews(persistence, request.user.id, nextViews, now);
            await this.audit(
                read,
                persistence,
                {
                    action: 'saved_view_create',
                    userId: request.user.id,
                    outcome: 'allowed',
                    scope: { viewId: nextView.id },
                },
                security,
            );

            return this.success({
                ok: true,
                action: 'create',
                view: this.toPublicView(nextView),
            });
        }

        if (mutation.action === 'update') {
            const index = views.findIndex((view) => view.id === mutation.id);
            if (index === -1) {
                return this.notFound('Saved view not found.');
            }

            const current = views[index];
            const updated: SavedView = {
                ...current,
                name: mutation.name || current.name,
                query: mutation.query || current.query,
                updatedAt: now,
            };

            const nextViews = [...views];
            nextViews[index] = updated;
            await this.writeViews(persistence, request.user.id, nextViews, now);
            await this.audit(
                read,
                persistence,
                {
                    action: 'saved_view_update',
                    userId: request.user.id,
                    outcome: 'allowed',
                    scope: { viewId: updated.id },
                },
                security,
            );

            return this.success({
                ok: true,
                action: 'update',
                view: this.toPublicView(updated),
            });
        }

        const nextViews = views.filter((view) => view.id !== mutation.id);
        if (nextViews.length === views.length) {
            return this.notFound('Saved view not found.');
        }

        await this.writeViews(persistence, request.user.id, nextViews, now);
        await this.audit(
            read,
            persistence,
            {
                action: 'saved_view_delete',
                userId: request.user.id,
                outcome: 'allowed',
                scope: { viewId: mutation.id },
            },
            security,
        );

        return this.success({
            ok: true,
            action: 'delete',
            deletedId: mutation.id,
        });
    }

    private readRequestedAction(content: unknown): 'create' | 'update' | 'delete' {
        const raw = content as { action?: unknown };
        if (raw && raw.action === 'create') {
            return 'create';
        }
        if (raw && raw.action === 'delete') {
            return 'delete';
        }
        return 'update';
    }

    private deniedActionFor(action: 'create' | 'update' | 'delete'): 'saved_view_create_denied' | 'saved_view_update_denied' | 'saved_view_delete_denied' {
        if (action === 'create') {
            return 'saved_view_create_denied';
        }
        if (action === 'delete') {
            return 'saved_view_delete_denied';
        }
        return 'saved_view_update_denied';
    }

    private async readViews(read: IRead, userId: string): Promise<Array<SavedView>> {
        const assoc = this.associationForUser(userId);
        const current = await read.getPersistenceReader().readByAssociation(assoc);
        const parsed = this.parseViewsRecord(current[0], userId);
        return parsed.views;
    }

    private async writeViews(persistence: IPersistence, userId: string, views: Array<SavedView>, updatedAt: string): Promise<void> {
        const assoc = this.associationForUser(userId);
        const payload: SavedViewsRecord = {
            updatedAt,
            views: views.slice(0, MAX_VIEWS_PER_USER),
        };
        await persistence.updateByAssociation(assoc, payload, true);
    }

    private parseViewsRecord(raw: unknown, userId: string): SavedViewsRecord {
        if (!raw || typeof raw !== 'object') {
            return { updatedAt: new Date(0).toISOString(), views: [] };
        }

        const candidate = raw as Partial<SavedViewsRecord>;
        const viewsRaw = Array.isArray(candidate.views) ? candidate.views : [];
        const views = viewsRaw
            .filter((view) => view && typeof view === 'object')
            .map((view) => view as SavedView)
            .filter((view) => view.userId === userId && typeof view.id === 'string' && typeof view.name === 'string');

        return {
            updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
            views,
        };
    }

    private toPublicView(view: SavedView): { id: string; name: string; query: SavedViewQuery; createdAt: string; updatedAt: string } {
        return {
            id: view.id,
            name: view.name,
            query: view.query,
            createdAt: view.createdAt,
            updatedAt: view.updatedAt,
        };
    }

    private associationForUser(userId: string): RocketChatAssociationRecord {
        return new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, `saved-views:user:${userId}`);
    }

    private generateViewId(): string {
        return `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    private readNumber(value: unknown, fallback: number, min: number, max: number): number {
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

    private notFound(message: string): IApiResponse {
        return this.json({
            status: HttpStatusCode.NOT_FOUND,
            content: {
                ok: false,
                error: message,
            },
        });
    }

    private async audit(
        read: IRead,
        persistence: IPersistence,
        entry: {
            action:
                | 'saved_view_list'
                | 'saved_view_list_denied'
                | 'saved_view_create'
                | 'saved_view_create_denied'
                | 'saved_view_update'
                | 'saved_view_update_denied'
                | 'saved_view_delete'
                | 'saved_view_delete_denied';
            userId: string;
            outcome: 'allowed' | 'denied';
            reason?: string;
            scope?: Record<string, unknown>;
        },
        security: { auditRetentionDays: number; auditMaxEntries: number },
    ): Promise<void> {
        try {
            await appendAuditEntry(read, persistence, entry, security.auditRetentionDays, security.auditMaxEntries);
        } catch {
            // Never block the primary flow when audit write fails.
        }
    }
}
