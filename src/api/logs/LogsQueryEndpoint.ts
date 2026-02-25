import { HttpStatusCode, IHttp, IHttpResponse, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';

import { SETTINGS } from '../../constants';
import {
    authorizeRequestUser,
    extractAuthHeaders,
    parseWorkspacePermissionCode,
    parseWorkspacePermissionMode,
    resolveWorkspaceOrigin,
    WorkspacePermissionMode,
} from '../../security/accessControl';
import { appendAuditEntry, consumeRateLimitToken, parseAllowedRoles } from '../../security/querySecurity';
import { redactLogMessage } from '../../security/redaction';
import { parseAndNormalizeQuery, QueryLevel } from './queryValidation';

type ResolvedLevel = QueryLevel | 'unknown';

type Guardrails = {
    maxTimeWindowHours: number;
    maxLinesPerQuery: number;
    queryTimeoutMs: number;
};

type SecuritySettings = {
    allowedRoles: Array<string>;
    workspacePermissionCode: string;
    workspacePermissionMode: WorkspacePermissionMode;
    rateLimitQpm: number;
    auditRetentionDays: number;
    auditMaxEntries: number;
};

type RedactionSettings = {
    enabled: boolean;
    replacement: string;
};

type LogEntry = {
    timestamp: string;
    rawTimestampNs: string;
    level: ResolvedLevel;
    message: string;
    labels: Record<string, string>;
};

type LogsSourceMode = 'loki' | 'app_logs';

type LokiStreamResult = {
    stream?: Record<string, string>;
    values?: Array<[string, string]>;
};

type LokiQueryResponse = {
    status?: string;
    error?: string;
    errorType?: string;
    data?: {
        resultType?: string;
        result?: Array<LokiStreamResult>;
    };
};

type AppLogsEntryPayload = {
    timestamp?: string;
    severity?: string;
    method?: string;
    args?: Array<unknown>;
    caller?: string;
};

type AppLogsRecordPayload = {
    method?: string;
    entries?: Array<AppLogsEntryPayload>;
};

type AppLogsQueryResponse = {
    success?: boolean;
    logs?: Array<AppLogsRecordPayload>;
    error?: string;
    total?: number;
};

export class LogsQueryEndpoint extends ApiEndpoint {
    public path = 'query';
    public authRequired = true;

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

        // Pull all runtime settings once; these drive auth, selector scoping, and guardrails.
        const settingsReader = read.getEnvironmentReader().getSettings();
        const [
            logsSourceModeRaw,
            lokiBaseUrl,
            lokiUsername,
            lokiToken,
            requiredLabelSelector,
            allowedRolesRaw,
            workspacePermissionCodeRaw,
            workspacePermissionModeRaw,
            enableRedactionRaw,
            redactionReplacementRaw,
            defaultTimeRange,
            maxTimeWindowHours,
            maxLinesPerQuery,
            queryTimeoutMs,
            rateLimitQpm,
            auditRetentionDays,
            auditMaxEntries,
        ] = await Promise.all([
            settingsReader.getValueById(SETTINGS.LOGS_SOURCE_MODE),
            settingsReader.getValueById(SETTINGS.LOKI_BASE_URL),
            settingsReader.getValueById(SETTINGS.LOKI_USERNAME),
            settingsReader.getValueById(SETTINGS.LOKI_TOKEN),
            settingsReader.getValueById(SETTINGS.REQUIRED_LABEL_SELECTOR),
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
            settingsReader.getValueById(SETTINGS.ENABLE_REDACTION),
            settingsReader.getValueById(SETTINGS.REDACTION_REPLACEMENT),
            settingsReader.getValueById(SETTINGS.DEFAULT_TIME_RANGE),
            settingsReader.getValueById(SETTINGS.MAX_TIME_WINDOW_HOURS),
            settingsReader.getValueById(SETTINGS.MAX_LINES_PER_QUERY),
            settingsReader.getValueById(SETTINGS.QUERY_TIMEOUT_MS),
            settingsReader.getValueById(SETTINGS.RATE_LIMIT_QPM),
            settingsReader.getValueById(SETTINGS.AUDIT_RETENTION_DAYS),
            settingsReader.getValueById(SETTINGS.AUDIT_MAX_ENTRIES),
        ]);

        const sourceMode = this.parseLogsSourceMode(logsSourceModeRaw);

        const security: SecuritySettings = {
            allowedRoles: parseAllowedRoles(allowedRolesRaw),
            workspacePermissionCode: parseWorkspacePermissionCode(workspacePermissionCodeRaw),
            workspacePermissionMode: parseWorkspacePermissionMode(workspacePermissionModeRaw),
            rateLimitQpm: this.readNumberSetting(rateLimitQpm, 60, 1, 1000),
            auditRetentionDays: this.readNumberSetting(auditRetentionDays, 90, 1, 365),
            auditMaxEntries: this.readNumberSetting(auditMaxEntries, 5000, 100, 20000),
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
                    action: 'query_denied',
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
                    error: 'Insufficient authorization for logs query.',
                    reason: accessDecision.reason || 'forbidden_role',
                },
            });
        }

        const rateLimit = await consumeRateLimitToken(read, persistence, request.user.id, security.rateLimitQpm);
        if (!rateLimit.allowed) {
            await this.audit(
                read,
                persistence,
                {
                    action: 'query_denied',
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
                    error: 'Rate limit exceeded for logs query.',
                    retryAfterSeconds: rateLimit.retryAfterSeconds || 1,
                },
            });
        }

        const guardrails: Guardrails = {
            maxTimeWindowHours: this.readNumberSetting(maxTimeWindowHours, 24, 1, 168),
            maxLinesPerQuery: this.readNumberSetting(maxLinesPerQuery, 2000, 100, 5000),
            queryTimeoutMs: this.readNumberSetting(queryTimeoutMs, 30000, 1000, 120000),
        };

        const redaction: RedactionSettings = {
            enabled: this.readBooleanSetting(enableRedactionRaw, true),
            replacement: this.readReplacementSetting(redactionReplacementRaw, '[REDACTED]'),
        };

        const normalizedResult = parseAndNormalizeQuery({
            requestQuery: (request.query || {}) as Record<string, unknown>,
            requestContent: request.content,
            defaultTimeRange: typeof defaultTimeRange === 'string' ? defaultTimeRange : '15m',
            maxTimeWindowHours: guardrails.maxTimeWindowHours,
            maxLinesPerQuery: guardrails.maxLinesPerQuery,
        });
        if ('error' in normalizedResult) {
            await this.audit(
                read,
                persistence,
                {
                    action: 'query_denied',
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: 'invalid_query',
                    scope: { details: normalizedResult.details },
                },
                security,
            );
            return this.badRequest(normalizedResult.error, normalizedResult.details);
        }

        const normalized = normalizedResult.query;
        const queryResult = sourceMode === 'app_logs'
            ? await this.queryRocketChatAppLogs(http, request, read, {
                  start: normalized.start,
                  end: normalized.end,
                  limit: normalized.limit,
                  level: normalized.level,
                  search: normalized.search,
                  timeoutMs: guardrails.queryTimeoutMs,
              })
            : await this.queryLokiSource(http, {
                  lokiBaseUrl,
                  lokiUsername,
                  lokiToken,
                  requiredLabelSelector,
                  start: normalized.start,
                  end: normalized.end,
                  limit: normalized.limit,
                  search: normalized.search,
                  timeoutMs: guardrails.queryTimeoutMs,
              });

        if ('error' in queryResult) {
            await this.audit(
                read,
                persistence,
                {
                    action: 'query_denied',
                    userId: request.user.id,
                    outcome: 'denied',
                    reason: sourceMode === 'app_logs' ? 'app_logs_error' : 'loki_error',
                    scope: {
                        sourceMode,
                    },
                },
                security,
            );
            return this.json({
                status: queryResult.status || (sourceMode === 'app_logs' ? HttpStatusCode.BAD_REQUEST : HttpStatusCode.BAD_GATEWAY),
                content: {
                    ok: false,
                    error: queryResult.error,
                    details: queryResult.details,
                },
            });
        }

        const flattened = queryResult.entries;
        const filteredByLevel = normalized.level ? flattened.filter((entry) => entry.level === normalized.level) : flattened;
        const sorted = filteredByLevel.sort((a, b) => this.compareNsDesc(a.rawTimestampNs, b.rawTimestampNs));
        const truncated = sorted.length > guardrails.maxLinesPerQuery;

        let redactedLines = 0;
        let totalRedactions = 0;
        const finalEntries = sorted.slice(0, guardrails.maxLinesPerQuery).map(({ rawTimestampNs, ...entry }) => {
            const redacted = redactLogMessage(entry.message, {
                enabled: redaction.enabled,
                replacement: redaction.replacement,
            });

            if (redacted.redacted) {
                redactedLines += 1;
                totalRedactions += redacted.redactionCount;
            }

            return {
                ...entry,
                message: redacted.message,
            };
        });

        await this.audit(
            read,
            persistence,
            {
                action: 'query',
                userId: request.user.id,
                outcome: 'allowed',
                scope: {
                    start: normalized.start.toISOString(),
                    end: normalized.end.toISOString(),
                    level: normalized.level || null,
                    searchProvided: Boolean(normalized.search),
                    returned: finalEntries.length,
                    truncated,
                    accessMode: accessDecision.mode,
                    redactedLines,
                    totalRedactions,
                },
            },
            security,
        );

        return this.json({
            status: HttpStatusCode.OK,
            content: {
                ok: true,
                source: sourceMode,
                meta: {
                    query: queryResult.query,
                    start: normalized.start.toISOString(),
                    end: normalized.end.toISOString(),
                    requestedLimit: normalized.limit,
                    returned: finalEntries.length,
                    truncated,
                    requestedLevel: normalized.level || null,
                    search: normalized.search || null,
                    redaction: {
                        enabled: redaction.enabled,
                        redactedLines,
                        totalRedactions,
                    },
                    access: {
                        mode: accessDecision.mode,
                        workspacePermissionCode: security.workspacePermissionCode,
                        workspacePermissionMode: security.workspacePermissionMode,
                    },
                    guardrails,
                },
                entries: finalEntries,
            },
        });
    }

    private buildLogQl(selector: string, search?: string): string {
        const escapedSearch = search ? search.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') : '';
        return escapedSearch ? `${selector} |= "${escapedSearch}"` : selector;
    }

    private parseLogsSourceMode(rawValue: unknown): LogsSourceMode {
        if (typeof rawValue !== 'string') {
            return 'loki';
        }

        const normalized = rawValue.trim().toLowerCase();
        if (normalized === 'app_logs' || normalized === 'loki') {
            return normalized;
        }

        return 'loki';
    }

    private async queryLokiSource(
        http: IHttp,
        args: {
            lokiBaseUrl: unknown;
            lokiUsername: unknown;
            lokiToken: unknown;
            requiredLabelSelector: unknown;
            start: Date;
            end: Date;
            limit: number;
            search?: string;
            timeoutMs: number;
        },
    ): Promise<{ entries: Array<LogEntry>; query: string } | { error: string; details?: unknown; status?: HttpStatusCode }> {
        const baseUrl = typeof args.lokiBaseUrl === 'string' ? args.lokiBaseUrl.trim() : '';
        if (!baseUrl) {
            return {
                error: 'Loki base URL is not configured.',
                status: HttpStatusCode.BAD_REQUEST,
                details: {
                    sourceMode: 'loki',
                    setting: SETTINGS.LOKI_BASE_URL,
                    hint: 'Set loki_base_url to your Loki endpoint origin (for example https://observability.example.com).',
                },
            };
        }

        const selector = typeof args.requiredLabelSelector === 'string' ? args.requiredLabelSelector.trim() : '';
        if (!this.isValidSelector(selector)) {
            return {
                error: 'Required label selector is invalid. Expected format like {job="rocketchat"} with no pipelines.',
                status: HttpStatusCode.BAD_REQUEST,
                details: {
                    sourceMode: 'loki',
                    setting: SETTINGS.REQUIRED_LABEL_SELECTOR,
                    hint: 'Use a plain selector like {job="rocketchat"} and do not include LogQL pipelines.',
                },
            };
        }

        const logQlQuery = this.buildLogQl(selector, args.search);
        const lokiResponse = await this.queryLoki(http, {
            baseUrl,
            username: typeof args.lokiUsername === 'string' ? args.lokiUsername.trim() : '',
            token: typeof args.lokiToken === 'string' ? args.lokiToken.trim() : '',
            query: logQlQuery,
            start: args.start,
            end: args.end,
            limit: args.limit,
            timeoutMs: args.timeoutMs,
        });
        if ('error' in lokiResponse) {
            return {
                error: lokiResponse.error,
                details: lokiResponse.details,
                status: HttpStatusCode.BAD_GATEWAY,
            };
        }

        return {
            entries: this.flattenResults(lokiResponse.payload.data?.result || []),
            query: logQlQuery,
        };
    }

    private async queryRocketChatAppLogs(
        http: IHttp,
        request: IApiRequest,
        read: IRead,
        args: {
            start: Date;
            end: Date;
            limit: number;
            level?: QueryLevel;
            search?: string;
            timeoutMs: number;
        },
    ): Promise<{ entries: Array<LogEntry>; query: string } | { error: string; details?: unknown; status?: HttpStatusCode }> {
        const auth = extractAuthHeaders(request.headers);
        if (!auth) {
            return {
                error: 'Request auth headers are unavailable for app logs mode.',
                status: HttpStatusCode.FORBIDDEN,
                details: {
                    sourceMode: 'app_logs',
                    requiredHeaders: ['x-user-id', 'x-auth-token'],
                },
            };
        }

        const workspaceOrigin = await resolveWorkspaceOrigin(read, request.headers);
        if (!workspaceOrigin) {
            return {
                error: 'Unable to resolve workspace origin for app logs mode.',
                status: HttpStatusCode.BAD_REQUEST,
                details: {
                    sourceMode: 'app_logs',
                    hint: 'Ensure Site_Url is configured or host/x-forwarded-proto headers are present.',
                },
            };
        }

        const levelFilter = this.toAppLogsLevel(args.level);
        const response = await http.get(`${workspaceOrigin}/api/apps/logs`, {
            headers: {
                Accept: 'application/json',
                'X-User-Id': auth.userId,
                'X-Auth-Token': auth.authToken,
            },
            params: {
                appId: this.app.getID(),
                startDate: args.start.toISOString(),
                endDate: args.end.toISOString(),
                count: String(args.limit),
                offset: '0',
                ...(typeof levelFilter === 'number' ? { logLevel: String(levelFilter) } : {}),
            },
            timeout: args.timeoutMs,
        });

        const parsed = this.parseRocketChatAppLogsResponse(response);
        if ('error' in parsed) {
            return {
                error: parsed.error,
                details: parsed.details,
                status: HttpStatusCode.BAD_GATEWAY,
            };
        }

        if (response.statusCode >= 400) {
            return {
                error: 'Rocket.Chat app logs API returned an error response.',
                status: HttpStatusCode.BAD_GATEWAY,
                details: {
                    statusCode: response.statusCode,
                    payload: parsed.payload,
                },
            };
        }

        if (parsed.payload.success === false) {
            return {
                error: parsed.payload.error || 'Rocket.Chat app logs API did not return success.',
                status: HttpStatusCode.BAD_REQUEST,
                details: parsed.payload,
            };
        }

        const entries = this.flattenRocketChatAppLogs(parsed.payload.logs || []);
        const filteredBySearch = args.search
            ? entries.filter((entry) => entry.message.toLowerCase().includes(args.search!.toLowerCase()))
            : entries;

        return {
            entries: filteredBySearch,
            query: `app_logs(appId="${this.app.getID()}", start="${args.start.toISOString()}", end="${args.end.toISOString()}")`,
        };
    }

    private async queryLoki(
        http: IHttp,
        args: {
            baseUrl: string;
            username?: string;
            token?: string;
            query: string;
            start: Date;
            end: Date;
            limit: number;
            timeoutMs: number;
        },
    ): Promise<{ payload: LokiQueryResponse } | { error: string; details?: unknown }> {
        const headers: Record<string, string> = {
            Accept: 'application/json',
        };

        if (args.username && args.token) {
            headers.Authorization = `Basic ${this.toBase64(`${args.username}:${args.token}`)}`;
        } else if (args.token) {
            headers.Authorization = `Bearer ${args.token}`;
        }

        const url = `${args.baseUrl.replace(/\/+$/, '')}/loki/api/v1/query_range`;
        const response = await http.get(url, {
            headers,
            params: {
                query: args.query,
                start: this.toEpochNs(args.start),
                end: this.toEpochNs(args.end),
                limit: String(args.limit),
                direction: 'backward',
            },
            timeout: args.timeoutMs,
        });

        const parsed = this.parseLokiResponse(response);
        if ('error' in parsed) {
            return parsed;
        }

        if (response.statusCode >= 400) {
            return {
                error: 'Loki returned an error response.',
                details: {
                    statusCode: response.statusCode,
                    payload: parsed.payload,
                },
            };
        }

        if (parsed.payload.status !== 'success') {
            return {
                error: 'Loki query did not return success status.',
                details: parsed.payload,
            };
        }

        return parsed;
    }

    private parseLokiResponse(response: IHttpResponse): { payload: LokiQueryResponse } | { error: string; details?: unknown } {
        if (response.data && typeof response.data === 'object') {
            return { payload: response.data as LokiQueryResponse };
        }

        if (typeof response.content === 'string' && response.content.trim()) {
            try {
                return { payload: JSON.parse(response.content) as LokiQueryResponse };
            } catch (error) {
                return {
                    error: 'Failed to parse Loki response payload as JSON.',
                    details: String(error),
                };
            }
        }

        return {
            error: 'Loki response did not contain a valid JSON payload.',
            details: {
                statusCode: response.statusCode,
            },
        };
    }

    private parseRocketChatAppLogsResponse(
        response: IHttpResponse,
    ): { payload: AppLogsQueryResponse } | { error: string; details?: unknown } {
        if (response.data && typeof response.data === 'object') {
            return { payload: response.data as AppLogsQueryResponse };
        }

        if (typeof response.content === 'string' && response.content.trim()) {
            try {
                return { payload: JSON.parse(response.content) as AppLogsQueryResponse };
            } catch (error) {
                return {
                    error: 'Failed to parse Rocket.Chat app logs response payload as JSON.',
                    details: String(error),
                };
            }
        }

        return {
            error: 'Rocket.Chat app logs response did not contain a valid JSON payload.',
            details: {
                statusCode: response.statusCode,
            },
        };
    }

    private flattenRocketChatAppLogs(records: Array<AppLogsRecordPayload>): Array<LogEntry> {
        const entries: Array<LogEntry> = [];

        for (const record of records) {
            const method = typeof record.method === 'string' ? record.method : '';
            const recordEntries = Array.isArray(record.entries) ? record.entries : [];
            for (const entry of recordEntries) {
                const timestamp = this.parseAppLogTimestamp(entry.timestamp);
                const level = this.normalizeLevel(entry.severity) || 'unknown';
                const message = this.buildAppLogMessage(method || entry.method, entry.args);
                entries.push({
                    timestamp: timestamp.iso,
                    rawTimestampNs: timestamp.rawTimestampNs,
                    level,
                    message,
                    labels: {
                        source: 'app_logs',
                        ...(method ? { method } : {}),
                        ...(typeof entry.caller === 'string' && entry.caller ? { caller: entry.caller } : {}),
                    },
                });
            }
        }

        return entries;
    }

    private parseAppLogTimestamp(rawValue: unknown): { iso: string; rawTimestampNs: string } {
        const parsed = typeof rawValue === 'string' ? Date.parse(rawValue) : NaN;
        if (!Number.isFinite(parsed)) {
            return {
                iso: new Date(0).toISOString(),
                rawTimestampNs: '0',
            };
        }

        return {
            iso: new Date(parsed).toISOString(),
            rawTimestampNs: (BigInt(Math.floor(parsed)) * 1000000n).toString(),
        };
    }

    private buildAppLogMessage(method: unknown, args: unknown): string {
        const methodText = typeof method === 'string' && method.trim() ? method.trim() : '';
        const argValues = Array.isArray(args) ? args : [];
        const serializedArgs = argValues.map((value) => this.serializeLogArg(value)).join(' ');
        const combined = [methodText, serializedArgs].filter(Boolean).join(' ');
        return combined || '[app log entry]';
    }

    private serializeLogArg(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (value === null || value === undefined) {
            return '';
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private toAppLogsLevel(level?: QueryLevel): number | undefined {
        if (!level) {
            return undefined;
        }

        // Rocket.Chat app logs API expects numeric levels (0=DEBUG, 1=INFO, 2=WARN/ERROR).
        if (level === 'debug') {
            return 0;
        }
        if (level === 'info') {
            return 1;
        }
        return 2;
    }

    private flattenResults(results: Array<LokiStreamResult>): Array<LogEntry> {
        const entries: Array<LogEntry> = [];
        for (const result of results) {
            const labels = result.stream || {};
            const values = result.values || [];

            for (const value of values) {
                if (!Array.isArray(value) || value.length < 2) {
                    continue;
                }

                const rawTimestampNs = String(value[0]);
                const message = String(value[1]);
                entries.push({
                    timestamp: this.nsToIso(rawTimestampNs),
                    rawTimestampNs,
                    level: this.resolveLevel(labels, message),
                    message,
                    labels,
                });
            }
        }

        return entries;
    }

    private resolveLevel(labels: Record<string, string>, message: string): ResolvedLevel {
        const labelCandidates = [labels.level, labels.severity, labels.lvl, labels.loglevel];
        for (const candidate of labelCandidates) {
            const normalized = this.normalizeLevel(candidate);
            if (normalized) {
                return normalized;
            }
        }

        if (/\b(error|err|fatal|panic|exception)\b/i.test(message)) {
            return 'error';
        }
        if (/\b(warn|warning)\b/i.test(message)) {
            return 'warn';
        }
        if (/\b(info|information)\b/i.test(message)) {
            return 'info';
        }
        if (/\b(debug|trace|verbose)\b/i.test(message)) {
            return 'debug';
        }

        return 'unknown';
    }

    private normalizeLevel(value?: string): QueryLevel | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = value.trim().toLowerCase();
        if (['error', 'err', 'fatal', 'panic'].includes(normalized)) {
            return 'error';
        }
        if (['warn', 'warning'].includes(normalized)) {
            return 'warn';
        }
        if (['info', 'information'].includes(normalized)) {
            return 'info';
        }
        if (['debug', 'trace', 'verbose'].includes(normalized)) {
            return 'debug';
        }
        return undefined;
    }

    private compareNsDesc(a: string, b: string): number {
        const aParsed = this.safeBigInt(a);
        const bParsed = this.safeBigInt(b);
        if (aParsed !== undefined && bParsed !== undefined) {
            if (aParsed === bParsed) {
                return 0;
            }
            return aParsed > bParsed ? -1 : 1;
        }

        return b.localeCompare(a);
    }

    private safeBigInt(value: string): bigint | undefined {
        try {
            return BigInt(value);
        } catch {
            return undefined;
        }
    }

    private nsToIso(rawNs: string): string {
        const parsed = this.safeBigInt(rawNs);
        if (parsed === undefined) {
            return new Date(0).toISOString();
        }

        const ms = Number(parsed / 1000000n);
        return new Date(ms).toISOString();
    }

    private toEpochNs(date: Date): string {
        return (BigInt(date.getTime()) * 1000000n).toString();
    }

    private toBase64(value: string): string {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(value).toString('base64');
        }

        if (typeof btoa !== 'undefined') {
            return btoa(value);
        }

        throw new Error('No base64 encoder available for Basic auth header.');
    }

    private readNumberSetting(value: unknown, fallback: number, min: number, max: number): number {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, Math.floor(parsed)));
    }

    private readBooleanSetting(value: unknown, fallback: boolean): boolean {
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true') {
                return true;
            }
            if (normalized === 'false') {
                return false;
            }
        }

        return fallback;
    }

    private readReplacementSetting(value: unknown, fallback: string): string {
        if (typeof value !== 'string') {
            return fallback;
        }

        const trimmed = value.trim();
        return trimmed || fallback;
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

    private invalidConfig(message: string): IApiResponse {
        return this.json({
            status: HttpStatusCode.INTERNAL_SERVER_ERROR,
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
            action: 'query' | 'query_denied';
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
            // Audit failures should not block primary query path.
        }
    }
}
