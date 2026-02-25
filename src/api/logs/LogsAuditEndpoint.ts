import { HttpStatusCode, IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';

import { SETTINGS } from '../../constants';
import { authorizeRequestUser, parseWorkspacePermissionCode, parseWorkspacePermissionMode } from '../../security/accessControl';
import { parseAllowedRoles, readAuditEntries } from '../../security/querySecurity';

export class LogsAuditEndpoint extends ApiEndpoint {
    public path = 'audit';
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
        const [allowedRolesRaw, workspacePermissionCodeRaw, workspacePermissionModeRaw, maxEntriesRaw] = await Promise.all([
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
            settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
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
                    error: 'Insufficient authorization for logs audit access.',
                    reason: decision.reason,
                },
            });
        }

        const absoluteMaxLimit = this.readNumber(maxEntriesRaw, 5000, 100, 20000);
        const requestedLimit = this.readNumber(request.query?.limit, 100, 1, absoluteMaxLimit);
        const offset = this.readNumber(request.query?.offset, 0, 0, absoluteMaxLimit);
        const filterUserId = typeof request.query?.userId === 'string' ? request.query.userId.trim() : '';
        const filterOutcome = typeof request.query?.outcome === 'string' ? request.query.outcome.trim().toLowerCase() : '';

        const auditResult = await readAuditEntries(read, { offset: 0, limit: absoluteMaxLimit });
        let entries = auditResult.entries;

        if (filterUserId) {
            entries = entries.filter((entry) => entry.userId === filterUserId);
        }
        if (filterOutcome === 'allowed' || filterOutcome === 'denied') {
            entries = entries.filter((entry) => entry.outcome === filterOutcome);
        }

        const paged = entries.slice(offset, offset + requestedLimit);

        return this.success({
            ok: true,
            meta: {
                total: entries.length,
                offset,
                limit: requestedLimit,
                filters: {
                    userId: filterUserId || null,
                    outcome: filterOutcome || null,
                },
            },
            entries: paged,
        });
    }

    private readNumber(value: unknown, fallback: number, min: number, max: number): number {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, Math.floor(parsed)));
    }
}
