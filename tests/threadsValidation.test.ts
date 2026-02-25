import { describe, expect, it } from 'bun:test';

import { parseThreadsQuery } from '../src/api/logs/threadsValidation';

describe('parseThreadsQuery', () => {
    it('requires roomId', () => {
        const parsed = parseThreadsQuery({}, {
            defaultLimit: 40,
            maxLimit: 100,
            maxSearchLength: 80,
            maxRoomIdLength: 128,
        });

        expect(parsed).toEqual({
            error: 'roomId query parameter is required.',
        });
    });

    it('normalizes roomId, limit, and search values', () => {
        const parsed = parseThreadsQuery(
            {
                roomId: '   abc123   ',
                limit: '500',
                search: '   thread-preview-search   ',
            },
            {
                defaultLimit: 40,
                maxLimit: 100,
                maxSearchLength: 8,
                maxRoomIdLength: 16,
            },
        );

        expect('query' in parsed).toBe(true);
        if ('query' in parsed) {
            expect(parsed.query.roomId).toBe('abc123');
            expect(parsed.query.limit).toBe(100);
            expect(parsed.query.search).toBe('thread-pre');
        }
    });

    it('truncates roomId by configured max length', () => {
        const parsed = parseThreadsQuery(
            {
                roomId: 'room-id-that-is-way-too-long',
            },
            {
                defaultLimit: 40,
                maxLimit: 100,
                maxRoomIdLength: 10,
            },
        );

        expect('query' in parsed).toBe(true);
        if ('query' in parsed) {
            expect(parsed.query.roomId).toBe('room-id-that-is-');
        }
    });
});
