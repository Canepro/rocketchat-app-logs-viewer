import { describe, expect, it } from 'bun:test';
import { HttpStatusCode } from '@rocket.chat/apps-engine/definition/accessors';

import { SETTINGS } from '../src/constants';
import { LogsViewsEndpoint } from '../src/api/logs/LogsViewsEndpoint';

const getAssocKey = (association: any): string => {
    if (association && typeof association.getID === 'function') {
        return String(association.getID());
    }
    if (association && typeof association.id === 'string') {
        return association.id;
    }
    return String(association);
};

const buildHarness = (input?: { settings?: Record<string, unknown>; seed?: Record<string, unknown> }) => {
    const store = new Map<string, unknown>(Object.entries(input?.seed || {}));
    const settings = {
        [SETTINGS.ALLOWED_ROLES]: 'admin',
        [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'off',
        [SETTINGS.WORKSPACE_PERMISSION_CODE]: 'view-logs',
        [SETTINGS.AUDIT_RETENTION_DAYS]: 90,
        [SETTINGS.AUDIT_MAX_ENTRIES]: 5000,
        ...(input?.settings || {}),
    };

    const read = {
        getEnvironmentReader: () => ({
            getSettings: () => ({
                getValueById: async (id: string) => settings[id],
            }),
            getServerSettings: () => ({
                getValueById: async () => {
                    throw new Error('Site_Url unavailable');
                },
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

    const persistence = {
        updateByAssociation: async (association: unknown, value: unknown) => {
            const key = getAssocKey(association);
            store.set(key, value);
        },
    };

    return { read: read as any, persistence: persistence as any, store };
};

const buildRequest = (input?: {
    roles?: Array<string>;
    query?: Record<string, unknown>;
    content?: unknown;
}): any => ({
    user: {
        id: 'u-admin',
        roles: input?.roles || ['admin'],
    },
    headers: {},
    query: input?.query || {},
    content: input?.content,
});

const endpoint = new LogsViewsEndpoint({} as any);

describe('LogsViewsEndpoint', () => {
    it('returns 401 when request user is missing', async () => {
        const { read, persistence } = buildHarness();
        const response = await endpoint.get(
            {
                headers: {},
                query: {},
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
        const { read, persistence, store } = buildHarness({
            settings: {
                [SETTINGS.ALLOWED_ROLES]: 'admin',
            },
        });

        const response = await endpoint.get(
            buildRequest({ roles: ['user'] }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Insufficient authorization for saved views.',
            reason: 'forbidden_role',
        });

        const auditRecord = store.get('audit:logs-query') as { entries?: Array<Record<string, unknown>> } | undefined;
        const deniedEntry = (auditRecord?.entries || []).find((entry) => entry.action === 'saved_view_list_denied');
        expect(deniedEntry).toMatchObject({
            action: 'saved_view_list_denied',
            userId: 'u-admin',
            outcome: 'denied',
            reason: 'forbidden_role',
        });
    });

    it('writes action-specific denied audit entry for unauthorized mutations', async () => {
        const { read, persistence, store } = buildHarness({
            settings: {
                [SETTINGS.ALLOWED_ROLES]: 'admin',
            },
        });

        const response = await endpoint.post(
            buildRequest({
                roles: ['user'],
                content: {
                    action: 'create',
                    name: 'Blocked view',
                    query: {
                        timeMode: 'relative',
                        since: '15m',
                        limit: 200,
                    },
                },
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
            error: 'Insufficient authorization for saved views.',
            reason: 'forbidden_role',
        });

        const auditRecord = store.get('audit:logs-query') as { entries?: Array<Record<string, unknown>> } | undefined;
        const deniedEntry = (auditRecord?.entries || []).find((entry) => entry.action === 'saved_view_create_denied');
        expect(deniedEntry).toMatchObject({
            action: 'saved_view_create_denied',
            userId: 'u-admin',
            outcome: 'denied',
            reason: 'forbidden_role',
        });
    });

    it('supports create, list, update, and delete flows', async () => {
        const { read, persistence } = buildHarness();

        const created = await endpoint.post(
            buildRequest({
                content: {
                    action: 'create',
                    name: 'Error bursts',
                    query: {
                        timeMode: 'relative',
                        since: '30m',
                        limit: 300,
                        level: 'error',
                    },
                },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(created.status).toBe(HttpStatusCode.OK);
        expect(created.content).toMatchObject({
            ok: true,
            action: 'create',
            view: {
                name: 'Error bursts',
            },
        });
        const createdId = (created.content as any).view.id as string;
        expect(typeof createdId).toBe('string');

        const listed = await endpoint.get(
            buildRequest(),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );
        expect(listed.status).toBe(HttpStatusCode.OK);
        expect((listed.content as any).views.items.length).toBe(1);

        const updated = await endpoint.post(
            buildRequest({
                content: {
                    action: 'update',
                    id: createdId,
                    name: 'Error bursts (updated)',
                },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );
        expect(updated.status).toBe(HttpStatusCode.OK);
        expect(updated.content).toMatchObject({
            ok: true,
            action: 'update',
            view: {
                id: createdId,
                name: 'Error bursts (updated)',
            },
        });

        const deleted = await endpoint.post(
            buildRequest({
                content: {
                    action: 'delete',
                    id: createdId,
                },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );
        expect(deleted.status).toBe(HttpStatusCode.OK);
        expect(deleted.content).toEqual({
            ok: true,
            action: 'delete',
            deletedId: createdId,
        });
    });

    it('returns 404 when updating a missing view', async () => {
        const { read, persistence } = buildHarness();
        const response = await endpoint.post(
            buildRequest({
                content: {
                    action: 'update',
                    id: 'sv_missing',
                    name: 'Missing',
                },
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.NOT_FOUND);
        expect(response.content).toEqual({
            ok: false,
            error: 'Saved view not found.',
        });
    });
});
