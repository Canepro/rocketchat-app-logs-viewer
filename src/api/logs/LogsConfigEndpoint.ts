import { HttpStatusCode, IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';

import { SETTINGS } from '../../constants';
import { authorizeRequestUser, parseWorkspacePermissionCode, parseWorkspacePermissionMode } from '../../security/accessControl';
import { parseAllowedRoles } from '../../security/querySecurity';

export class LogsConfigEndpoint extends ApiEndpoint {
    public path = 'config';
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
        const [logsSourceModeRaw, lokiBaseUrl, requiredLabelSelector, allowedRolesRaw, workspacePermissionCodeRaw, workspacePermissionModeRaw, defaultTimeRange, maxTimeWindowHours, maxLinesPerQuery, queryTimeoutMs, rateLimitQpm, externalComponentUrl] = await Promise.all([
            settingsReader.getValueById(SETTINGS.LOGS_SOURCE_MODE),
            settingsReader.getValueById(SETTINGS.LOKI_BASE_URL),
            settingsReader.getValueById(SETTINGS.REQUIRED_LABEL_SELECTOR),
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
            settingsReader.getValueById(SETTINGS.DEFAULT_TIME_RANGE),
            settingsReader.getValueById(SETTINGS.MAX_TIME_WINDOW_HOURS),
            settingsReader.getValueById(SETTINGS.MAX_LINES_PER_QUERY),
            settingsReader.getValueById(SETTINGS.QUERY_TIMEOUT_MS),
            settingsReader.getValueById(SETTINGS.RATE_LIMIT_QPM),
            settingsReader.getValueById(SETTINGS.EXTERNAL_COMPONENT_URL),
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
                    error: 'Insufficient authorization for logs access.',
                    reason: decision.reason,
                },
            });
        }

        const sourceMode = this.parseLogsSourceMode(logsSourceModeRaw);
        const readinessIssues: Array<string> = [];
        if (sourceMode === 'loki') {
            const baseUrl = typeof lokiBaseUrl === 'string' ? lokiBaseUrl.trim() : '';
            const selector = typeof requiredLabelSelector === 'string' ? requiredLabelSelector.trim() : '';
            if (!baseUrl) {
                readinessIssues.push('Loki base URL is not configured.');
            }
            if (!this.isValidSelector(selector)) {
                readinessIssues.push('Required label selector is invalid. Use a plain selector like {job="rocketchat"} with no pipelines.');
            }
        }

        return this.success({
            ok: true,
            config: {
                lokiBaseUrl,
                sourceMode,
                defaultTimeRange,
                maxTimeWindowHours,
                maxLinesPerQuery,
                queryTimeoutMs,
                rateLimitQpm,
                levelParserMode: 'label_then_fallback',
                externalComponentUrl,
                workspacePermissionCode: parseWorkspacePermissionCode(workspacePermissionCodeRaw),
                workspacePermissionMode: parseWorkspacePermissionMode(workspacePermissionModeRaw),
                accessMode: decision.mode,
                readiness: {
                    ready: readinessIssues.length === 0,
                    issues: readinessIssues,
                },
            },
        });
    }

    private parseLogsSourceMode(rawValue: unknown): 'loki' | 'app_logs' {
        if (typeof rawValue !== 'string') {
            return 'loki';
        }

        const normalized = rawValue.trim().toLowerCase();
        if (normalized === 'app_logs') {
            return 'app_logs';
        }

        return 'loki';
    }

    private isValidSelector(selector: string): boolean {
        if (!selector) {
            return false;
        }
        if (!selector.startsWith('{') || !selector.endsWith('}')) {
            return false;
        }
        if (selector.includes('|') || selector.includes('\n') || selector.includes('\r')) {
            return false;
        }
        return true;
    }
}
