import { describe, expect, it } from 'bun:test';
import { HttpStatusCode } from '@rocket.chat/apps-engine/definition/accessors';

import { SETTINGS } from '../src/constants';
import { LogsActionsEndpoint } from '../src/api/logs/LogsActionsEndpoint';

type Harness = {
    read: any;
    persistence: any;
    store: Map<string, unknown>;
};

const getAssocKey = (association: any): string => {
    if (association && typeof association.getID === 'function') {
        return String(association.getID());
    }
    if (association && typeof association.id === 'string') {
        return association.id;
    }
    return String(association);
};

const createPersistenceHarness = (seed: Record<string, unknown> = {}): Harness => {
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

const buildRead = (input?: {
    settings?: Record<string, unknown>;
    rooms?: Record<string, unknown>;
    userRoomIds?: Array<string>;
    threadExists?: boolean;
    threadRoomId?: string;
    seed?: Record<string, unknown>;
}) => {
    const persistenceHarness = createPersistenceHarness(input?.seed);
    const settings = {
        [SETTINGS.ALLOWED_ROLES]: 'admin',
        [SETTINGS.WORKSPACE_PERMISSION_CODE]: 'view-logs',
        [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'off',
        [SETTINGS.RATE_LIMIT_QPM]: 60,
        [SETTINGS.AUDIT_RETENTION_DAYS]: 90,
        [SETTINGS.AUDIT_MAX_ENTRIES]: 5000,
        ...(input?.settings || {}),
    };

    const read = {
        ...persistenceHarness.read,
        getEnvironmentReader: () => ({
            getSettings: () => ({
                getValueById: async (id: string) => settings[id],
            }),
        }),
        getRoomReader: () => ({
            getById: async (roomId: string) => (input?.rooms || {})[roomId],
        }),
        getUserReader: () => ({
            getUserRoomIds: async (_userId: string) => input?.userRoomIds || [],
            getAppUser: async () => ({ id: 'app-user' }),
        }),
        getMessageReader: () => ({
            getById: async () => (input?.threadExists ? { id: 'thread-1' } : undefined),
            getRoom: async () => (input?.threadExists ? { id: input?.threadRoomId || 'room-1' } : undefined),
        }),
    };

    return {
        read,
        persistence: persistenceHarness.persistence,
        store: persistenceHarness.store,
    };
};

const validActionPayload = (overrides?: Record<string, unknown>) => ({
    action: 'share',
    targetRoomId: 'room-1',
    entry: {
        timestamp: '2026-02-25T10:00:00.000Z',
        level: 'error',
        message: 'Webhook timeout',
        labels: {
            job: 'rocketchat',
        },
    },
    ...(overrides || {}),
});

const buildRequest = (input?: { roles?: Array<string>; content?: unknown }): any => ({
    user: {
        id: 'u-admin',
        roles: input?.roles || ['admin'],
    },
    headers: {},
    content: input?.content,
    query: {},
});

const endpoint = new LogsActionsEndpoint({ getID: () => 'app-id' } as any);

describe('LogsActionsEndpoint negative paths', () => {
    it('returns 401 when request user is missing', async () => {
        const { read, persistence } = buildRead();
        const response = await endpoint.post(
            { headers: {}, query: {}, content: validActionPayload() } as any,
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

    it('returns 429 when action rate limit is exceeded', async () => {
        const now = Date.now();
        const { read, persistence } = buildRead({
            settings: {
                [SETTINGS.RATE_LIMIT_QPM]: 1,
            },
            seed: {
                'rate-limit:user:action:u-admin': {
                    windowStartMs: now,
                    count: 1,
                    updatedAt: new Date(now).toISOString(),
                },
            },
        });

        const response = await endpoint.post(
            buildRequest({ content: validActionPayload() }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
        expect(response.headers).toHaveProperty('retry-after');
        expect(response.content).toMatchObject({
            ok: false,
            error: 'Rate limit exceeded for logs actions.',
        });
    });

    it('returns 400 for invalid action payload', async () => {
        const { read, persistence } = buildRead();
        const response = await endpoint.post(
            buildRequest({
                content: {
                    ...validActionPayload(),
                    unsupported: true,
                },
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
            error: 'Action payload contains unsupported fields.',
        });
    });

    it('writes denied audit entry when action authorization fails', async () => {
        const { read, persistence, store } = buildRead({
            settings: {
                [SETTINGS.ALLOWED_ROLES]: 'admin',
            },
        });

        const response = await endpoint.post(
            buildRequest({
                roles: ['user'],
                content: validActionPayload({
                    action: 'thread_note',
                    targetThreadId: 'thread-1',
                }),
            }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);

        const auditRecord = store.get('audit:logs-query') as { entries?: Array<Record<string, unknown>> } | undefined;
        const deniedEntry = (auditRecord?.entries || []).find((entry) => entry.action === 'thread_note_denied');
        expect(deniedEntry).toMatchObject({
            action: 'thread_note_denied',
            userId: 'u-admin',
            outcome: 'denied',
            reason: 'forbidden_role',
        });
    });

    it('returns 403 when user cannot access target room', async () => {
        const { read, persistence } = buildRead({
            rooms: {
                'room-1': { id: 'room-1', slugifiedName: 'general', type: 'c' },
            },
            userRoomIds: ['room-2'],
        });

        const response = await endpoint.post(
            buildRequest({ content: validActionPayload() }),
            {} as any,
            read,
            {} as any,
            {} as any,
            persistence,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toEqual({
            ok: false,
            error: 'User does not have access to target room.',
            reason: 'forbidden_room_access',
        });
    });

    it('returns 400 when thread target does not exist in room', async () => {
        const { read, persistence } = buildRead({
            rooms: {
                'room-1': { id: 'room-1', slugifiedName: 'general', type: 'c' },
            },
            userRoomIds: ['room-1'],
            threadExists: false,
        });

        const response = await endpoint.post(
            buildRequest({
                content: validActionPayload({
                    action: 'thread_note',
                    targetThreadId: 'missing-thread',
                }),
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
            error: 'Target thread does not exist in target room.',
        });
    });
});
