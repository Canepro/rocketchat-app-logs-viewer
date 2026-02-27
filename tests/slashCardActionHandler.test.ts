import { describe, expect, it } from 'bun:test';

import { handleSlashCardBlockAction, handleSlashCardViewSubmit } from '../src/commands/slashCardActionHandler';
import { encodeSlashCardActionPayload, SLASH_CARD_ACTION, SlashCardActionPayload } from '../src/commands/slashCardActions';

type StubMessageState = {
    text: string;
    room?: unknown;
    sender?: unknown;
    threadId?: string;
    groupable?: boolean;
    parseUrls?: boolean;
};

const createMessageBuilder = (): any => {
    const state: StubMessageState = { text: '' };
    const builder: any = {
        setSender(sender: unknown) {
            state.sender = sender;
            return builder;
        },
        setRoom(room: unknown) {
            state.room = room;
            return builder;
        },
        setThreadId(threadId: string) {
            state.threadId = threadId;
            return builder;
        },
        setText(text: string) {
            state.text = text;
            return builder;
        },
        setGroupable(groupable: boolean) {
            state.groupable = groupable;
            return builder;
        },
        setParseUrls(parseUrls: boolean) {
            state.parseUrls = parseUrls;
            return builder;
        },
        getMessage() {
            return { ...state };
        },
    };

    return builder;
};

const createModalBlockBuilder = (): any => {
    const blocks: Array<any> = [];
    return {
        newMarkdownTextObject(text: string) {
            return { type: 'mrkdwn', text };
        },
        newPlainTextObject(text: string) {
            return { type: 'plain_text', text };
        },
        newPlainTextInputElement(input: Record<string, unknown>) {
            return { type: 'plain_text_input', ...input };
        },
        newButtonElement(input: Record<string, unknown>) {
            return { type: 'button', ...input };
        },
        addSectionBlock(block: Record<string, unknown>) {
            blocks.push({ type: 'section', ...block });
        },
        addInputBlock(block: Record<string, unknown>) {
            blocks.push({ type: 'input', ...block });
        },
        addContextBlock(block: Record<string, unknown>) {
            blocks.push({ type: 'context', ...block });
        },
        getBlocks() {
            return blocks;
        },
    };
};

const appUser = {
    id: 'app-user',
    username: 'logs-viewer.bot',
    name: 'Logs Viewer',
    roles: ['bot'],
} as any;

const room = {
    id: 'room-1',
    displayName: 'Support_Stuff',
    slugifiedName: 'support_stuff',
} as any;

const payload: SlashCardActionPayload = {
    version: 1,
    roomId: 'room-1',
    roomName: 'Support_Stuff',
    threadId: 'thread-1',
    sourceMode: 'loki',
    windowLabel: 'last 15m',
    filterSummary: 'since=15m, limit=200',
    preset: 'none',
    sampleTotalCount: 2,
    sampleOutput: [
        { level: 'error', text: '2026-02-25T10:00:00.000Z Connection ended' },
        { level: 'warn', text: '2026-02-25T10:00:01.000Z Received first command' },
    ],
};

const createRead = (
    allowedRoles: string,
    actorRoles: Array<string> = ['admin'],
    options?: {
        actorId?: string;
        userRoomIds?: Array<string>;
        roomsById?: Record<string, any>;
        threadRoomById?: Record<string, string>;
        slashSnapshotStoreRecord?: unknown;
        shareElsewhereStoreRecord?: unknown;
    },
): any => ({
    getUserReader: () => ({
        getAppUser: async () => appUser,
        getById: async () => ({
            id: options?.actorId || 'u1',
            roles: actorRoles,
        }),
        getUserRoomIds: async () => options?.userRoomIds || ['room-1'],
    }),
    getRoomReader: () => ({
        getById: async (roomId: string) => options?.roomsById?.[roomId] || room,
    }),
    getMessageReader: () => ({
        getById: async (threadId: string) => options?.threadRoomById?.[threadId] ? ({ id: threadId } as any) : undefined,
        getRoom: async (threadId: string) => {
            const threadRoomId = options?.threadRoomById?.[threadId];
            if (!threadRoomId) {
                return undefined;
            }

            return options?.roomsById?.[threadRoomId] || room;
        },
    }),
    getEnvironmentReader: () => ({
        getSettings: () => ({
            getValueById: async (id: string) => {
                const values: Record<string, unknown> = {
                    allowed_roles: allowedRoles,
                    audit_retention_days: 7,
                    audit_max_entries: 2000,
                };
                return values[id];
            },
        }),
    }),
    getPersistenceReader: () => ({
        readByAssociation: async (association: any) => {
            const id = typeof association?.id === 'string' ? association.id : '';
            if (id.includes(`slash-card-samples:user:${options?.actorId || 'u1'}`) && options?.slashSnapshotStoreRecord) {
                return [options.slashSnapshotStoreRecord];
            }
            if (id.includes(`slash-card-share-elsewhere:user:${options?.actorId || 'u1'}`) && options?.shareElsewhereStoreRecord) {
                return [options.shareElsewhereStoreRecord];
            }

            return [];
        },
    }),
});

describe('slashCardActionHandler', () => {
    it('returns private copy-ready sample for copy action', async () => {
        const notifications: Array<any> = [];
        const finishes: Array<any> = [];
        const auditWrites: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async (builder: any) => {
                    finishes.push(builder.getMessage());
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.COPY_SAMPLE,
                value: encodeSlashCardActionPayload(payload),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin']),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(finishes.length).toBe(0);
        expect(auditWrites.length).toBe(0);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Only you can see this `/logs` action response.');
        expect((notifications[0] as any).text).toContain('Copy-ready sample (private):');
        expect((notifications[0] as any).text).toContain('Render mode: full_line_priority');
        expect((notifications[0] as any).text).toContain('01 [error] 2026-02-25T10:00:00.000Z Connection ended');
        expect((notifications[0] as any).text).toContain('Lines=2/2');
    });

    it('shares sample to room and writes share audit entry', async () => {
        const notifications: Array<any> = [];
        const finishes: Array<any> = [];
        const auditWrites: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async (builder: any) => {
                    finishes.push(builder.getMessage());
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.SHARE_SAMPLE,
                value: encodeSlashCardActionPayload(payload),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin']),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(finishes.length).toBe(1);
        expect(finishes[0].threadId).toBe('thread-1');
        expect(finishes[0].text).toContain('*Logs sample shared from `/logs`*');
        expect(finishes[0].text).toContain('Render mode: full_line_priority');
        expect(finishes[0].text).toContain('Lines: 2/2');
        expect(finishes[0].text).toContain('01 [error] 2026-02-25T10:00:00.000Z Connection ended');
        expect(auditWrites.length).toBe(1);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Shared 2 of 2 sampled line(s)');
    });

    it('opens share elsewhere modal and stores one-time request context', async () => {
        const notifications: Array<any> = [];
        const opens: Array<any> = [];
        const auditWrites: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                getBlockBuilder: () => createModalBlockBuilder(),
            }),
            getUiController: () => ({
                openSurfaceView: async (...args: Array<unknown>) => {
                    opens.push(args);
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.SHARE_ELSEWHERE,
                value: encodeSlashCardActionPayload(payload),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin']),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(opens.length).toBe(1);
        expect((opens[0][0] as any).type).toBe('modal');
        expect((opens[0][0] as any).id).toContain('logs_slash_share_elsewhere_modal:');
        expect(auditWrites.length).toBe(1);
        expect(notifications.length).toBe(0);
    });

    it('retries share to room timeline when thread publish fails', async () => {
        const notifications: Array<any> = [];
        const finishes: Array<any> = [];
        const auditWrites: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async (builder: any) => {
                    const message = builder.getMessage();
                    if (message.threadId) {
                        throw new Error('thread is no longer available');
                    }
                    finishes.push(message);
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.SHARE_SAMPLE,
                value: encodeSlashCardActionPayload(payload),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin']),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(finishes.length).toBe(1);
        expect(finishes[0].threadId).toBeUndefined();
        expect(finishes[0].text).toContain('*Logs sample shared from `/logs`*');
        expect(auditWrites.length).toBe(1);
        expect((notifications[0] as any).text).toContain('to room successfully');
    });

    it('returns explicit private error when share publish fails entirely', async () => {
        const notifications: Array<any> = [];
        const finishes: Array<any> = [];
        const auditWrites: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async () => {
                    throw new Error('publish failed');
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.SHARE_SAMPLE,
                value: encodeSlashCardActionPayload(payload),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin']),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(finishes.length).toBe(0);
        expect(auditWrites.length).toBe(1);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Share sample failed while posting to Rocket.Chat');
    });

    it('denies unauthorized share action and writes denied audit entry', async () => {
        const notifications: Array<any> = [];
        const finishes: Array<any> = [];
        const auditWrites: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async (builder: any) => {
                    finishes.push(builder.getMessage());
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.SHARE_SAMPLE,
                value: encodeSlashCardActionPayload(payload),
                room,
                user: { id: 'u1', roles: ['user'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['user']),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(finishes.length).toBe(0);
        expect(auditWrites.length).toBe(1);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('do not have permission');
    });

    it('loads sample lines from persisted snapshot when payload only includes snapshot id', async () => {
        const notifications: Array<any> = [];
        const freshSnapshotIso = new Date().toISOString();
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async () => undefined,
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const payloadWithSnapshot: SlashCardActionPayload = {
            ...payload,
            snapshotId: 'snap_abc',
            sampleTotalCount: 10,
            sampleOutput: [],
        };

        const slashSnapshotStoreRecord = {
            updatedAt: freshSnapshotIso,
            entries: [
                {
                    id: 'snap_abc',
                    createdAt: freshSnapshotIso,
                    roomId: 'room-1',
                    roomName: 'Support_Stuff',
                    threadId: 'thread-1',
                    sourceMode: 'loki',
                    windowLabel: 'last 15m',
                    filterSummary: 'since=15m, limit=200',
                    preset: 'none',
                    sampleOutput: [
                        { level: 'error', text: '2026-02-26T00:00:00.000Z Primary failure line' },
                        { level: 'warn', text: '2026-02-26T00:00:01.000Z Secondary warning line' },
                    ],
                    sampleTotalCount: 10,
                },
            ],
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.COPY_SAMPLE,
                value: encodeSlashCardActionPayload(payloadWithSnapshot),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin'], { actorId: 'u1', slashSnapshotStoreRecord }),
            modify,
            {
                updateByAssociation: async () => undefined,
            } as any,
        );

        expect(handled).toBe(true);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Primary failure line');
        expect((notifications[0] as any).text).toContain('Lines=2/10');
    });

    it('shares elsewhere on modal submit when target room is accessible', async () => {
        const notifications: Array<any> = [];
        const finishes: Array<any> = [];
        const auditWrites: Array<any> = [];
        const requestId = 'req_submit_ok';
        const nowIso = new Date().toISOString();
        const targetRoom = {
            id: 'room-2',
            displayName: 'Incidents',
            slugifiedName: 'incidents',
        } as any;

        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async (builder: any) => {
                    finishes.push(builder.getMessage());
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardViewSubmit(
            'app-id',
            {
                appId: 'app-id',
                triggerId: 't-submit',
                user: { id: 'u1', roles: ['admin'] },
                room,
                view: {
                    id: `logs_slash_share_elsewhere_modal:${requestId}`,
                    state: {
                        values: {
                            share_elsewhere_target_room: {
                                share_elsewhere_target_room_input: {
                                    type: 'plain_text_input',
                                    value: 'Incidents',
                                },
                            },
                            share_elsewhere_target_thread: {
                                share_elsewhere_target_thread_input: {
                                    type: 'plain_text_input',
                                    value: '',
                                },
                            },
                        },
                    },
                } as any,
            } as any,
            createRead('admin', ['admin'], {
                actorId: 'u1',
                userRoomIds: ['room-1', 'room-2'],
                roomsById: {
                    'room-1': room,
                    'room-2': targetRoom,
                },
                shareElsewhereStoreRecord: {
                    updatedAt: nowIso,
                    entries: [
                        {
                            id: requestId,
                            createdAt: nowIso,
                            actionPayload: encodeSlashCardActionPayload(payload),
                        },
                    ],
                },
            }),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(finishes.length).toBe(1);
        expect(finishes[0].room?.id).toBe('room-2');
        expect(finishes[0].text).toContain('*Logs sample shared from `/logs`*');
        expect(auditWrites.length).toBe(2);
        expect((notifications[0] as any).text).toContain('Shared 2 of 2 sampled line(s)');
        expect((notifications[0] as any).text).toContain('Incidents');
    });

    it('denies share elsewhere modal submit when target room is not accessible', async () => {
        const notifications: Array<any> = [];
        const finishes: Array<any> = [];
        const auditWrites: Array<any> = [];
        const requestId = 'req_submit_denied';
        const nowIso = new Date().toISOString();

        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async (builder: any) => {
                    finishes.push(builder.getMessage());
                },
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const handled = await handleSlashCardViewSubmit(
            'app-id',
            {
                appId: 'app-id',
                triggerId: 't-submit',
                user: { id: 'u1', roles: ['admin'] },
                room,
                view: {
                    id: `logs_slash_share_elsewhere_modal:${requestId}`,
                    state: {
                        values: {
                            share_elsewhere_target_room: {
                                share_elsewhere_target_room_input: {
                                    type: 'plain_text_input',
                                    value: 'Forbidden_Room',
                                },
                            },
                        },
                    },
                } as any,
            } as any,
            createRead('admin', ['admin'], {
                actorId: 'u1',
                userRoomIds: ['room-1'],
                roomsById: {
                    'room-1': room,
                },
                shareElsewhereStoreRecord: {
                    updatedAt: nowIso,
                    entries: [
                        {
                            id: requestId,
                            createdAt: nowIso,
                            actionPayload: encodeSlashCardActionPayload(payload),
                        },
                    ],
                },
            }),
            modify,
            {
                updateByAssociation: async (...args: Array<unknown>) => auditWrites.push(args),
            } as any,
        );

        expect(handled).toBe(true);
        expect(finishes.length).toBe(0);
        expect(auditWrites.length).toBe(1);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('do not have access to target room');
    });

    it('preserves long snapshot line text in copy output', async () => {
        const notifications: Array<any> = [];
        const freshSnapshotIso = new Date().toISOString();
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async () => undefined,
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const longTailMarker = '__LONG_SNAPSHOT_LINE_MARKER__';
        const payloadWithSnapshot: SlashCardActionPayload = {
            ...payload,
            snapshotId: 'snap_long',
            sampleOutput: [],
        };

        const slashSnapshotStoreRecord = {
            updatedAt: freshSnapshotIso,
            entries: [
                {
                    id: 'snap_long',
                    createdAt: freshSnapshotIso,
                    roomId: 'room-1',
                    roomName: 'Support_Stuff',
                    threadId: 'thread-1',
                    sourceMode: 'loki',
                    windowLabel: 'last 15m',
                    filterSummary: 'since=15m, limit=200',
                    preset: 'none',
                    sampleOutput: [
                        {
                            level: 'error',
                            text: `${'a'.repeat(500)} ${longTailMarker} ${'b'.repeat(200)}`,
                        },
                    ],
                    sampleTotalCount: 1,
                },
            ],
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.COPY_SAMPLE,
                value: encodeSlashCardActionPayload(payloadWithSnapshot),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin'], { actorId: 'u1', slashSnapshotStoreRecord }),
            modify,
            {
                updateByAssociation: async () => undefined,
            } as any,
        );

        expect(handled).toBe(true);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Render mode: full_line_priority');
        expect((notifications[0] as any).text).toContain(longTailMarker);
    });

    it('fails safely when snapshot id is stale and no fallback sample exists', async () => {
        const notifications: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async () => undefined,
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const payloadWithMissingSnapshot: SlashCardActionPayload = {
            ...payload,
            snapshotId: 'snap_missing',
            sampleOutput: [],
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.COPY_SAMPLE,
                value: encodeSlashCardActionPayload(payloadWithMissingSnapshot),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin'], { actorId: 'u1' }),
            modify,
            {
                updateByAssociation: async () => undefined,
            } as any,
        );

        expect(handled).toBe(true);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Sample details are no longer available');
    });

    it('uses inline fallback sample when snapshot id is stale', async () => {
        const notifications: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async () => undefined,
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const payloadWithFallbackSample: SlashCardActionPayload = {
            ...payload,
            snapshotId: 'snap_missing',
            sampleTotalCount: 10,
            sampleOutput: [{ level: 'error', text: 'Fallback line from inline payload' }],
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.COPY_SAMPLE,
                value: encodeSlashCardActionPayload(payloadWithFallbackSample),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin'], { actorId: 'u1' }),
            modify,
            {
                updateByAssociation: async () => undefined,
            } as any,
        );

        expect(handled).toBe(true);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Copy-ready sample (private):');
        expect((notifications[0] as any).text).toContain('Fallback line from inline payload');
        expect((notifications[0] as any).text).not.toContain('Sample details are no longer available');
    });

    it('treats expired snapshot as unavailable and asks user to rerun /logs', async () => {
        const notifications: Array<any> = [];
        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                finish: async () => undefined,
            }),
            getNotifier: () => ({
                notifyUser: async (_user: unknown, message: unknown) => notifications.push(message),
            }),
        };

        const payloadWithSnapshot: SlashCardActionPayload = {
            ...payload,
            snapshotId: 'snap_expired',
            sampleOutput: [],
        };

        const slashSnapshotStoreRecord = {
            updatedAt: '2026-02-26T00:00:00.000Z',
            entries: [
                {
                    id: 'snap_expired',
                    createdAt: '2020-01-01T00:00:00.000Z',
                    roomId: 'room-1',
                    roomName: 'Support_Stuff',
                    threadId: 'thread-1',
                    sourceMode: 'loki',
                    windowLabel: 'last 15m',
                    filterSummary: 'since=15m, limit=200',
                    preset: 'none',
                    sampleOutput: [{ level: 'error', text: 'Expired line' }],
                    sampleTotalCount: 1,
                },
            ],
        };

        const handled = await handleSlashCardBlockAction(
            'app-id',
            {
                appId: 'app-id',
                actionId: SLASH_CARD_ACTION.COPY_SAMPLE,
                value: encodeSlashCardActionPayload(payloadWithSnapshot),
                room,
                user: { id: 'u1', roles: ['admin'] },
                triggerId: 't1',
                blockId: 'b1',
                container: { id: 'c1', type: 'contextual_bar' } as any,
            } as any,
            createRead('admin', ['admin'], { actorId: 'u1', slashSnapshotStoreRecord }),
            modify,
            {
                updateByAssociation: async () => undefined,
            } as any,
        );

        expect(handled).toBe(true);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Sample details are no longer available');
    });
});
