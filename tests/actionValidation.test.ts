import { describe, expect, it } from 'bun:test';

import { composeActionMessage, parseAndNormalizeLogActionRequest } from '../src/api/logs/actionValidation';

describe('parseAndNormalizeLogActionRequest', () => {
    it('parses valid share action payload', () => {
        const result = parseAndNormalizeLogActionRequest({
            action: 'share',
            targetRoomId: 'GENERAL',
            entry: {
                timestamp: '2026-02-24T12:00:00.000Z',
                level: 'error',
                message: 'Webhook timeout',
                labels: {
                    job: 'rocketchat',
                },
            },
            context: {
                source: 'slash-command',
                preset: 'incident',
            },
        });

        expect('request' in result).toBe(true);
        if ('request' in result) {
            expect(result.request.action).toBe('share');
            expect(result.request.targetRoomId).toBe('GENERAL');
            expect(result.request.entry.labels.job).toBe('rocketchat');
            expect(result.request.context.preset).toBe('incident');
        }
    });

    it('rejects unknown payload fields', () => {
        const result = parseAndNormalizeLogActionRequest({
            action: 'share',
            targetRoomId: 'GENERAL',
            entry: {
                timestamp: '2026-02-24T12:00:00.000Z',
                level: 'error',
                message: 'Webhook timeout',
                labels: {},
            },
            extra: 'not-supported',
        });

        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error).toContain('unsupported fields');
        }
    });

    it('rejects invalid action values', () => {
        const result = parseAndNormalizeLogActionRequest({
            action: 'delete',
            targetRoomId: 'GENERAL',
            entry: {
                timestamp: '2026-02-24T12:00:00.000Z',
                level: 'error',
                message: 'Webhook timeout',
                labels: {},
            },
        });

        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error).toContain('Invalid action');
        }
    });

    it('parses valid thread_note action payload', () => {
        const result = parseAndNormalizeLogActionRequest({
            action: 'thread_note',
            targetRoomId: 'GENERAL',
            targetThreadId: 'THREAD123',
            entry: {
                timestamp: '2026-02-24T12:00:00.000Z',
                level: 'info',
                message: 'Observed a retry loop in this thread',
                labels: {
                    service: 'notifications',
                },
            },
        });

        expect('request' in result).toBe(true);
        if ('request' in result) {
            expect(result.request.action).toBe('thread_note');
            expect(result.request.targetThreadId).toBe('THREAD123');
        }
    });
});

describe('composeActionMessage', () => {
    it('renders share message with labels and quoted evidence', () => {
        const parsed = parseAndNormalizeLogActionRequest({
            action: 'share',
            targetRoomId: 'GENERAL',
            entry: {
                timestamp: '2026-02-24T12:00:00.000Z',
                level: 'warn',
                message: 'Timeout while delivering webhook\nstatus=504',
                labels: {
                    service: 'webhook',
                    env: 'prod',
                },
            },
            context: {
                source: 'viewer',
            },
        });

        if (!('request' in parsed)) {
            throw new Error('Expected parsed payload');
        }

        const output = composeActionMessage(parsed.request);
        expect(output).toContain('Log Entry Shared');
        expect(output).toContain('> Timeout while delivering webhook');
        expect(output).toContain('`service=webhook`');
    });

    it('renders incident draft template with next actions', () => {
        const parsed = parseAndNormalizeLogActionRequest({
            action: 'incident_draft',
            targetRoomId: 'GENERAL',
            entry: {
                timestamp: '2026-02-24T12:00:00.000Z',
                level: 'error',
                message: 'Database connection timeout',
                labels: {
                    service: 'api',
                },
            },
        });

        if (!('request' in parsed)) {
            throw new Error('Expected parsed payload');
        }

        const output = composeActionMessage(parsed.request);
        expect(output).toContain('Incident Draft');
        expect(output).toContain('Next actions');
        expect(output).toContain('Confirm blast radius');
    });

    it('renders thread note template', () => {
        const parsed = parseAndNormalizeLogActionRequest({
            action: 'thread_note',
            targetRoomId: 'GENERAL',
            targetThreadId: 'THREAD123',
            entry: {
                timestamp: '2026-02-24T12:00:00.000Z',
                level: 'info',
                message: 'Linked evidence to thread',
                labels: {
                    service: 'api',
                },
            },
            context: {
                source: 'viewer',
                search: 'timeout',
            },
        });

        if (!('request' in parsed)) {
            throw new Error('Expected parsed payload');
        }

        const output = composeActionMessage(parsed.request);
        expect(output).toContain('Thread Note');
        expect(output).toContain('Search context');
        expect(output).toContain('> Linked evidence to thread');
    });
});
