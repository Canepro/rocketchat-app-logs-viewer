import { describe, expect, it } from 'bun:test';
import { HttpStatusCode } from '@rocket.chat/apps-engine/definition/accessors';

import { SETTINGS } from '../src/constants';
import { LogsAuditEndpoint } from '../src/api/logs/LogsAuditEndpoint';

const getAssocKey = (association: any): string => {
    if (association && typeof association.getID === 'function') {
        return String(association.getID());
    }
    if (association && typeof association.id === 'string') {
        return association.id;
    }
    return String(association);
};

const buildRead = (input?: { settings?: Record<string, unknown>; seed?: Record<string, unknown> }): any => {
    const store = new Map<string, unknown>(Object.entries(input?.seed || {}));
    const settings = {
        [SETTINGS.ALLOWED_ROLES]: 'admin',
        [SETTINGS.WORKSPACE_PERMISSION_CODE]: 'view-logs',
        [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'off',
        [SETTINGS.AUDIT_MAX_ENTRIES]: 5000,
        ...(input?.settings || {}),
    };

    return {
        getEnvironmentReader: () => ({
            getSettings: () => ({
                getValueById: async (id: string) => settings[id],
            }),
        }),
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
};

const buildRequest = (input?: {
    roles?: Array<string>;
    headers?: Record<string, string>;
    query?: Record<string, unknown>;
}): any => ({
    user: {
        id: 'u-admin',
        roles: input?.roles || ['admin'],
    },
    headers: input?.headers || {},
    query: input?.query || {},
});

const endpoint = new LogsAuditEndpoint({} as any);

describe('LogsAuditEndpoint', () => {
    it('returns 401 when request user is missing', async () => {
        const response = await endpoint.get(
            { headers: {}, query: {} } as any,
            {} as any,
            buildRead(),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.UNAUTHORIZED);
        expect(response.content).toEqual({
            ok: false,
            error: 'Authentication required.',
        });
    });

    it('returns 403 when caller is not authorized', async () => {
        const response = await endpoint.get(
            buildRequest({ roles: ['user'] }),
            {} as any,
            buildRead({
                settings: {
                    [SETTINGS.ALLOWED_ROLES]: 'admin',
                },
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Insufficient authorization for logs audit access.',
            reason: 'forbidden_role',
        });
    });

    it('returns 403 in strict mode when permission check is unavailable', async () => {
        const response = await endpoint.get(
            buildRequest(),
            {} as any,
            buildRead({
                settings: {
                    [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'strict',
                },
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Insufficient authorization for logs audit access.',
            reason: 'permission_unavailable',
        });
    });

    it('returns 200 in fallback mode when permission check is unavailable and role is allowed', async () => {
        const response = await endpoint.get(
            buildRequest(),
            {} as any,
            buildRead({
                settings: {
                    [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'fallback',
                },
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(response.content).toMatchObject({
            ok: true,
            meta: {
                total: 0,
            },
            entries: [],
        });
    });

    it('applies user/outcome filters and pagination', async () => {
        const read = buildRead({
            seed: {
                'audit:logs-query': {
                    updatedAt: '2026-02-25T12:00:00.000Z',
                    entries: [
                        {
                            action: 'query',
                            userId: 'u-1',
                            timestamp: '2026-02-25T10:00:00.000Z',
                            outcome: 'allowed',
                        },
                        {
                            action: 'query_denied',
                            userId: 'u-1',
                            timestamp: '2026-02-25T11:00:00.000Z',
                            outcome: 'denied',
                        },
                        {
                            action: 'share',
                            userId: 'u-2',
                            timestamp: '2026-02-25T12:00:00.000Z',
                            outcome: 'allowed',
                        },
                    ],
                },
            },
        });

        const response = await endpoint.get(
            buildRequest({
                query: {
                    userId: 'u-1',
                    outcome: 'denied',
                    limit: 5,
                    offset: 0,
                },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(response.content).toEqual({
            ok: true,
            meta: {
                total: 1,
                offset: 0,
                limit: 5,
                filters: {
                    userId: 'u-1',
                    outcome: 'denied',
                },
            },
            entries: [
                {
                    action: 'query_denied',
                    userId: 'u-1',
                    timestamp: '2026-02-25T11:00:00.000Z',
                    outcome: 'denied',
                },
            ],
        });
    });
});
