import { describe, expect, it } from 'bun:test';
import { HttpStatusCode } from '@rocket.chat/apps-engine/definition/accessors';

import { SETTINGS } from '../src/constants';
import { LogsThreadsEndpoint } from '../src/api/logs/LogsThreadsEndpoint';

type BuildReadOptions = {
    settings?: Record<string, unknown>;
    rooms?: Record<string, unknown>;
    userRoomIds?: Array<string>;
    recentMessages?: Array<unknown>;
    messageById?: Record<string, unknown>;
    messageRoomById?: Record<string, unknown>;
    captureGetMessagesOptions?: (options: unknown) => void;
};

const buildRead = (options: BuildReadOptions = {}): any => {
    const settings = {
        [SETTINGS.ALLOWED_ROLES]: 'admin',
        [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'off',
        [SETTINGS.WORKSPACE_PERMISSION_CODE]: 'view-logs',
        ...(options.settings || {}),
    };

    return {
        getEnvironmentReader: () => ({
            getSettings: () => ({
                getValueById: async (id: string) => settings[id],
            }),
        }),
        getRoomReader: () => ({
            getById: async (roomId: string) => (options.rooms || {})[roomId],
            getMessages: async (_roomId: string, messageOptions: unknown) => {
                options.captureGetMessagesOptions?.(messageOptions);
                return options.recentMessages || [];
            },
        }),
        getUserReader: () => ({
            getUserRoomIds: async (_userId: string) => options.userRoomIds || [],
        }),
        getMessageReader: () => ({
            getById: async (messageId: string) => (options.messageById || {})[messageId],
            getRoom: async (messageId: string) => (options.messageRoomById || {})[messageId],
        }),
    };
};

const buildRequest = (input?: { roles?: Array<string>; roomId?: string; limit?: number; search?: string }): any => ({
    user: {
        id: 'u-admin',
        roles: input?.roles || ['admin'],
    },
    headers: {},
    query: {
        ...(input?.roomId ? { roomId: input.roomId } : {}),
        ...(typeof input?.limit === 'number' ? { limit: input.limit } : {}),
        ...(input?.search ? { search: input.search } : {}),
    },
});

const endpoint = new LogsThreadsEndpoint({} as any);

describe('LogsThreadsEndpoint', () => {
    it('returns 401 when request user is missing', async () => {
        const response = await endpoint.get(
            { headers: {}, query: { roomId: 'room-1' } } as any,
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
            buildRequest({ roles: ['user'], roomId: 'room-1' }),
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
            error: 'Insufficient authorization for logs threads access.',
            reason: 'forbidden_role',
        });
    });

    it('returns 400 when roomId is missing', async () => {
        const response = await endpoint.get(
            buildRequest({}),
            {} as any,
            buildRead(),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.BAD_REQUEST);
        expect(response.content).toEqual({
            ok: false,
            error: 'roomId query parameter is required.',
        });
    });

    it('returns 403 when user is not a member of the target room', async () => {
        const response = await endpoint.get(
            buildRequest({ roomId: 'room-1' }),
            {} as any,
            buildRead({
                rooms: {
                    'room-1': { id: 'room-1', slugifiedName: 'general', type: 'c' },
                },
                userRoomIds: ['room-2'],
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(response.content).toEqual({
            ok: false,
            error: 'User does not have access to target room.',
            reason: 'forbidden_room_access',
        });
    });

    it('returns filtered and sorted thread targets for an authorized room member', async () => {
        let capturedGetMessagesOptions: unknown;
        const response = await endpoint.get(
            buildRequest({ roomId: 'room-1', limit: 2 }),
            {} as any,
            buildRead({
                rooms: {
                    'room-1': { id: 'room-1', slugifiedName: 'general', type: 'c' },
                },
                userRoomIds: ['room-1'],
                recentMessages: [
                    { threadId: 'thread-1', createdAt: new Date('2026-02-25T12:10:00.000Z') },
                    { threadId: 'thread-2', createdAt: new Date('2026-02-25T12:11:00.000Z') },
                    { threadId: 'thread-1', createdAt: new Date('2026-02-25T12:12:00.000Z') },
                    { threadId: 'thread-3', createdAt: new Date('2026-02-25T12:13:00.000Z') },
                ],
                messageById: {
                    'thread-1': {
                        id: 'thread-1',
                        text: 'Webhook timeout retry exceeded',
                        createdAt: new Date('2026-02-25T12:00:00.000Z'),
                        updatedAt: new Date('2026-02-25T12:05:00.000Z'),
                    },
                    'thread-2': {
                        id: 'thread-2',
                        text: 'Database pool saturation warning',
                        createdAt: new Date('2026-02-25T11:50:00.000Z'),
                        updatedAt: new Date('2026-02-25T11:55:00.000Z'),
                    },
                    'thread-3': {
                        id: 'thread-3',
                        text: 'Cross-room thread should be filtered out',
                        createdAt: new Date('2026-02-25T11:49:00.000Z'),
                    },
                },
                messageRoomById: {
                    'thread-1': { id: 'room-1' },
                    'thread-2': { id: 'room-1' },
                    'thread-3': { id: 'room-x' },
                },
                captureGetMessagesOptions: (value) => {
                    capturedGetMessagesOptions = value;
                },
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(capturedGetMessagesOptions).toEqual({
            limit: 40,
            skip: 0,
            sort: { createdAt: 'desc' },
            showThreadMessages: true,
        });

        expect(response.content).toMatchObject({
            ok: true,
            threads: {
                meta: {
                    roomId: 'room-1',
                    total: 2,
                    returned: 2,
                    limit: 2,
                    search: null,
                },
                items: [
                    {
                        id: 'thread-1',
                        preview: 'Webhook timeout retry exceeded',
                        sampleReplyCount: 2,
                        lastActivityAt: '2026-02-25T12:12:00.000Z',
                    },
                    {
                        id: 'thread-2',
                        preview: 'Database pool saturation warning',
                        sampleReplyCount: 1,
                        lastActivityAt: '2026-02-25T12:11:00.000Z',
                    },
                ],
            },
        });
    });

    it('caps message scan limit to supported reader bounds', async () => {
        let capturedGetMessagesOptions: any;

        const response = await endpoint.get(
            buildRequest({ roomId: 'room-1', limit: 100 }),
            {} as any,
            buildRead({
                rooms: {
                    'room-1': { id: 'room-1', slugifiedName: 'general', type: 'c' },
                },
                userRoomIds: ['room-1'],
                captureGetMessagesOptions: (value) => {
                    capturedGetMessagesOptions = value;
                },
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(capturedGetMessagesOptions).toMatchObject({
            limit: 100,
            showThreadMessages: true,
        });
    });
});
