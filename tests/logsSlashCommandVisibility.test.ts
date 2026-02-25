import { LogsSlashCommand } from '../src/commands/LogsSlashCommand';
import { decodeSlashCardActionPayload, SLASH_CARD_ACTION } from '../src/commands/slashCardActions';

type StubMessageState = {
    text: string;
    room?: unknown;
    sender?: unknown;
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

const createBlockBuilder = (): any => {
    const blocks: Array<any> = [];
    return {
        newMarkdownTextObject(text: string) {
            return { type: 'mrkdwn', text };
        },
        newPlainTextObject(text: string) {
            return { type: 'plain_text', text };
        },
        newButtonElement(opts: Record<string, unknown>) {
            return { type: 'button', ...opts };
        },
        addSectionBlock(block: Record<string, unknown>) {
            blocks.push({ type: 'section', ...block });
        },
        addActionsBlock(block: Record<string, unknown>) {
            blocks.push({ type: 'actions', ...block });
        },
        addContextBlock(block: Record<string, unknown>) {
            blocks.push({ type: 'context', ...block });
        },
        getBlocks() {
            return blocks;
        },
    };
};

describe('LogsSlashCommand visibility behavior', () => {
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

    const createRead = (overrides?: Record<string, unknown>): any => ({
        getUserReader: () => ({
            getAppUser: async () => appUser,
        }),
        getEnvironmentReader: () => ({
            getSettings: () => ({
                getValueById: async (id: string) => {
                    const values: Record<string, unknown> = {
                        allowed_roles: 'admin',
                        external_component_url: 'https://viewer.example.com',
                        default_time_range: '15m',
                        max_lines_per_query: 2000,
                        logs_source_mode: 'loki',
                        loki_base_url: 'https://observability.example.com',
                        loki_username: '',
                        loki_token: '',
                        required_label_selector: '{namespace="rocketchat"}',
                        ...(overrides || {}),
                    };
                    return values[id];
                },
            }),
        }),
    });

    const createHttp = (overrides?: Record<string, unknown>): any => ({
        get: async () => ({
            statusCode: 200,
            data: {
                status: 'success',
                data: {
                    result: [
                        {
                            stream: {
                                level: 'error',
                            },
                            values: [
                                ['1767225600000000000', '{"msg":"Connection ended"}'],
                                ['1767225601000000000', '{"msg":"Connection ended"}'],
                                ['1767225602000000000', '{"msg":"Received first command"}'],
                            ],
                        },
                    ],
                },
            },
            ...(overrides || {}),
        }),
    });

    it('sends denied slash responses only to requesting user', async () => {
        const command = new LogsSlashCommand('test-app-id');
        const notifications: Array<any> = [];
        const opens: Array<any> = [];
        const finishes: Array<any> = [];

        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                getBlockBuilder: () => createBlockBuilder(),
                finish: async (builder: unknown) => {
                    finishes.push(builder);
                    return 'message-id';
                },
            }),
            getNotifier: () => ({
                notifyUser: async (user: unknown, message: unknown) => {
                    notifications.push({ user, message });
                },
            }),
            getUiController: () => ({
                openSurfaceView: async (...args: Array<unknown>) => {
                    opens.push(args);
                },
            }),
        };

        const context: any = {
            getSender: () => ({ id: 'u1', username: 'vincent', roles: ['user'] }),
            getRoom: () => room,
            getArguments: () => [],
            getThreadId: () => undefined,
            getTriggerId: () => 'trigger-1',
        };

        await command.executor(context, createRead(), modify, createHttp(), {} as any);

        expect(notifications.length).toBe(1);
        expect((notifications[0].message as any).text).toContain('Only you can see this `/logs` response.');
        expect((notifications[0].message as any).text).toContain('do not have permission');
        expect(opens.length).toBe(0);
        expect(finishes.length).toBe(0);
    });

    it('opens private contextual bar for allowed user without posting room message', async () => {
        const command = new LogsSlashCommand('test-app-id');
        const notifications: Array<any> = [];
        const opens: Array<any> = [];
        const finishes: Array<any> = [];

        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                getBlockBuilder: () => createBlockBuilder(),
                finish: async (builder: unknown) => {
                    finishes.push(builder);
                    return 'message-id';
                },
            }),
            getNotifier: () => ({
                notifyUser: async (user: unknown, message: unknown) => {
                    notifications.push({ user, message });
                },
            }),
            getUiController: () => ({
                openSurfaceView: async (view: unknown, interaction: unknown, user: unknown) => {
                    opens.push({ view, interaction, user });
                },
            }),
        };

        const sender = { id: 'u1', username: 'vincent', roles: ['admin'] };
        const context: any = {
            getSender: () => sender,
            getRoom: () => room,
            getArguments: () => ['since=15m', 'limit=200'],
            getThreadId: () => undefined,
            getTriggerId: () => 'trigger-1',
        };

        await command.executor(context, createRead(), modify, createHttp(), {} as any);

        expect(opens.length).toBe(1);
        expect((opens[0].view as any).type).toBe('contextualBar');
        const actionBlocks = ((opens[0].view as any).blocks as Array<any>).filter((block) => block.type === 'actions');
        const cardActionButtons = (actionBlocks[1]?.elements || []) as Array<any>;
        expect(cardActionButtons.some((button) => button.actionId === SLASH_CARD_ACTION.COPY_SAMPLE)).toBe(true);
        expect(cardActionButtons.some((button) => button.actionId === SLASH_CARD_ACTION.SHARE_SAMPLE)).toBe(true);
        const decodedPayload = decodeSlashCardActionPayload(cardActionButtons[0]?.value);
        expect(decodedPayload?.roomId).toBe('room-1');
        expect(decodedPayload?.roomName).toBe('Support_Stuff');
        expect(decodedPayload?.sampleOutput.length).toBe(3);

        const flattenedText = JSON.stringify((opens[0].view as any).blocks);
        expect(flattenedText).toContain('Only you can see this `/logs` response.');
        expect(flattenedText).toContain('Quick triage summary');
        expect(flattenedText).toContain('Sample lines: 3');
        expect(flattenedText).toContain('Top levels: error:3');
        expect(flattenedText).toContain('Sample output preview:');
        expect(flattenedText).toContain('2026-01-01T00:00:00.000Z');
        expect(flattenedText).toContain('[error] 2026-01-01T00:00:00.000Z Connection ended');
        expect(flattenedText).toContain('Connection ended');
        expect(notifications.length).toBe(0);
        expect(finishes.length).toBe(0);
    });

    it('returns app_logs summary note when source mode is app_logs', async () => {
        const command = new LogsSlashCommand('test-app-id');
        const opens: Array<any> = [];

        const modify: any = {
            getCreator: () => ({
                startMessage: () => createMessageBuilder(),
                getBlockBuilder: () => createBlockBuilder(),
                finish: async () => 'message-id',
            }),
            getNotifier: () => ({
                notifyUser: async () => undefined,
            }),
            getUiController: () => ({
                openSurfaceView: async (view: unknown, interaction: unknown, user: unknown) => {
                    opens.push({ view, interaction, user });
                },
            }),
        };

        const context: any = {
            getSender: () => ({ id: 'u1', username: 'vincent', roles: ['admin'] }),
            getRoom: () => room,
            getArguments: () => ['since=15m'],
            getThreadId: () => undefined,
            getTriggerId: () => 'trigger-1',
        };

        await command.executor(
            context,
            createRead({ logs_source_mode: 'app_logs' }),
            modify,
            createHttp(),
            {} as any,
        );

        expect(opens.length).toBe(1);
        const flattenedText = JSON.stringify((opens[0].view as any).blocks);
        expect(flattenedText).toContain('Source: `app_logs`');
        expect(flattenedText).toContain('Sample output: n/a');
        expect(flattenedText).toContain('Quick sample is unavailable in app_logs mode');
    });
});
