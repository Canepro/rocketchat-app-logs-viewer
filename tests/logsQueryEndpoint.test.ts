import { describe, expect, it } from 'bun:test';
import { HttpStatusCode } from '@rocket.chat/apps-engine/definition/accessors';

import { SETTINGS } from '../src/constants';
import { LogsQueryEndpoint } from '../src/api/logs/LogsQueryEndpoint';

const getAssocKey = (association: any): string => {
    if (association && typeof association.getID === 'function') {
        return String(association.getID());
    }
    if (association && typeof association.id === 'string') {
        return association.id;
    }
    return String(association);
};

const createPersistenceHarness = (seed: Record<string, unknown> = {}) => {
    const store = new Map<string, unknown>(Object.entries(seed));
    const read = {
        getPersistenceReader: () => ({
            readByAssociation: async (association: unknown) => {
                const key = getAssocKey(association);
                if (!store.has(key)) {
                    return [];
                }
                return [store.get(key)];
            },
        }),
    };
    const persistence = {
        updateByAssociation: async (association: unknown, value: unknown) => {
            const key = getAssocKey(association);
            store.set(key, value);
        },
    };
    return { read, persistence, store };
};

const buildRead = (input?: { settings?: Record<string, unknown>; seed?: Record<string, unknown>; siteUrl?: string }) => {
    const persistenceHarness = createPersistenceHarness(input?.seed);
    const settings = {
        [SETTINGS.LOKI_BASE_URL]: 'http://loki.example.com',
        [SETTINGS.REQUIRED_LABEL_SELECTOR]: '{job="rocketchat"}',
        [SETTINGS.ALLOWED_ROLES]: 'admin',
        [SETTINGS.WORKSPACE_PERMISSION_CODE]: 'view-logs',
        [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'off',
        [SETTINGS.DEFAULT_TIME_RANGE]: '15m',
        [SETTINGS.MAX_TIME_WINDOW_HOURS]: 24,
        [SETTINGS.MAX_LINES_PER_QUERY]: 2000,
        [SETTINGS.QUERY_TIMEOUT_MS]: 30000,
        [SETTINGS.RATE_LIMIT_QPM]: 60,
        [SETTINGS.AUDIT_RETENTION_DAYS]: 90,
        [SETTINGS.AUDIT_MAX_ENTRIES]: 5000,
        [SETTINGS.ENABLE_REDACTION]: true,
        [SETTINGS.REDACTION_REPLACEMENT]: '[REDACTED]',
        ...(input?.settings || {}),
    };

    const read = {
        ...persistenceHarness.read,
        getEnvironmentReader: () => ({
            getServerSettings: () => ({
                getValueById: async () => {
                    if (!input?.siteUrl) {
                        throw new Error('Site_Url unavailable');
                    }
                    return input.siteUrl;
                },
            }),
            getSettings: () => ({
                getValueById: async (id: string) => settings[id],
            }),
        }),
    };

    return { read, persistence: persistenceHarness.persistence, store: persistenceHarness.store };
};

const buildRequest = (input?: {
    roles?: Array<string>;
    headers?: Record<string, string>;
    content?: unknown;
    query?: Record<string, unknown>;
}): any => ({
    user: {
        id: 'u-admin',
        roles: input?.roles || ['admin'],
    },
    headers: input?.headers || {},
    query: input?.query || {},
    content: input?.content,
});

const endpoint = new LogsQueryEndpoint({
    getID: () => 'test-app-id',
} as any);

describe('LogsQueryEndpoint negative paths', () => {
    it('returns 401 when request user is missing', async () => {
        const { read, persistence } = buildRead();
        const response = await endpoint.post(
            {
                headers: {},
                query: {},
                content: { since: '15m', limit: 10 },
            } as any,
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.UNAUTHORIZED);
        expect(response.content).toEqual({
            ok: false,
            error: 'Authentication required.',
        });
    });

    it('returns 403 when caller role is not allowed', async () => {
        const { read, persistence, store } = buildRead({
            settings: {
                [SETTINGS.ALLOWED_ROLES]: 'admin',
            },
        });

        const response = await endpoint.post(
            buildRequest({
                roles: ['user'],
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Insufficient authorization for logs query.',
            reason: 'forbidden_role',
        });

        const auditRecord = store.get('audit:logs-query') as { entries?: Array<Record<string, unknown>> } | undefined;
        const deniedEntry = (auditRecord?.entries || []).find((entry) => entry.action === 'query_denied');
        expect(deniedEntry).toMatchObject({
            action: 'query_denied',
            userId: 'u-admin',
            outcome: 'denied',
            reason: 'forbidden_role',
        });
    });

    it('returns 403 in strict mode when permission check is unavailable', async () => {
        const { read, persistence } = buildRead({
            settings: {
                [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'strict',
            },
        });

        const response = await endpoint.post(
            buildRequest({
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Insufficient authorization for logs query.',
            reason: 'permission_unavailable',
        });
    });

    it('returns 200 in fallback mode when permission check is unavailable and role is allowed', async () => {
        const { read, persistence } = buildRead({
            settings: {
                [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'fallback',
            },
        });
        const http = {
            get: async () => ({
                statusCode: 200,
                data: {
                    status: 'success',
                    data: {
                        resultType: 'streams',
                        result: [],
                    },
                },
            }),
        };

        const response = await endpoint.post(
            buildRequest({
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            http as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(response.content).toMatchObject({
            ok: true,
            source: 'loki',
        });
    });

    it('returns 429 when query rate limit is exceeded', async () => {
        const now = Date.now();
        const { read, persistence } = buildRead({
            settings: {
                [SETTINGS.RATE_LIMIT_QPM]: 1,
            },
            seed: {
                'rate-limit:user:u-admin': {
                    windowStartMs: now,
                    count: 1,
                    updatedAt: new Date(now).toISOString(),
                },
            },
        });

        const response = await endpoint.post(
            buildRequest({
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Rate limit exceeded for logs query.',
        });
    });

    it('returns 400 for invalid query payload', async () => {
        const { read, persistence } = buildRead();
        const response = await endpoint.post(
            buildRequest({
                content: { since: '15m', limit: 10, unsupported: true },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Unsupported query parameters.',
        });
    });

    it('returns 502 when Loki upstream returns an error response', async () => {
        const { read, persistence } = buildRead();
        const http = {
            get: async () => ({
                statusCode: 502,
                data: {
                    status: 'error',
                    error: 'upstream timeout',
                },
            }),
        };

        const response = await endpoint.post(
            buildRequest({
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            http as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.BAD_GATEWAY);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Loki returned an error response.',
        });
    });

    it('returns 200 from app_logs source mode when Rocket.Chat app logs API succeeds', async () => {
        const { read, persistence } = buildRead({
            settings: {
                [SETTINGS.LOGS_SOURCE_MODE]: 'app_logs',
            },
        });
        const http = {
            get: async () => ({
                statusCode: 200,
                data: {
                    success: true,
                    logs: [
                        {
                            method: 'app:onEnable',
                            entries: [
                                {
                                    timestamp: '2026-02-25T19:00:00.000Z',
                                    severity: 'debug',
                                    args: [{ msg: 'enabled' }],
                                },
                            ],
                        },
                    ],
                },
            }),
        };

        const response = await endpoint.post(
            buildRequest({
                headers: {
                    host: 'k8.canepro.me',
                    'x-forwarded-proto': 'https',
                    'x-user-id': 'u-admin',
                    'x-auth-token': 'token-1',
                },
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            http as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(response.content).toMatchObject({
            ok: true,
            source: 'app_logs',
            entries: [
                {
                    level: 'debug',
                },
            ],
        });
    });

    it('returns 403 in app_logs source mode when request auth headers are missing', async () => {
        const { read, persistence } = buildRead({
            settings: {
                [SETTINGS.LOGS_SOURCE_MODE]: 'app_logs',
            },
        });

        const response = await endpoint.post(
            buildRequest({
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Request auth headers are unavailable for app logs mode.',
        });
    });

    it('returns 400 with actionable details when Loki selector setting is invalid', async () => {
        const { read, persistence } = buildRead({
            settings: {
                [SETTINGS.REQUIRED_LABEL_SELECTOR]: 'job="rocketchat"',
            },
        });

        const response = await endpoint.post(
            buildRequest({
                content: { since: '15m', limit: 10 },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Required label selector is invalid. Expected format like {job="rocketchat"} with no pipelines.',
            details: {
                setting: SETTINGS.REQUIRED_LABEL_SELECTOR,
                sourceMode: 'loki',
            },
        });
    });
});
