import { describe, expect, it } from 'bun:test';

import { handleSlashCardBlockAction } from '../src/commands/slashCardActionHandler';
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
    sampleOutput: [
        { level: 'error', text: '2026-02-25T10:00:00.000Z Connection ended' },
        { level: 'warn', text: '2026-02-25T10:00:01.000Z Received first command' },
    ],
};

const createRead = (allowedRoles: string, actorRoles: Array<string> = ['admin']): any => ({
    getUserReader: () => ({
        getAppUser: async () => appUser,
        getById: async () => ({
            id: 'u1',
            roles: actorRoles,
        }),
    }),
    getRoomReader: () => ({
        getById: async () => room,
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
        readByAssociation: async () => [],
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
        expect((notifications[0] as any).text).toContain('Connection ended');
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
        expect(finishes[0].text).toContain('Connection ended');
        expect(auditWrites.length).toBe(1);
        expect(notifications.length).toBe(1);
        expect((notifications[0] as any).text).toContain('Shared 2 sample line(s)');
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
});
