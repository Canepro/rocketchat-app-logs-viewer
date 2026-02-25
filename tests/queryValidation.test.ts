import { describe, expect, it } from 'bun:test';

import { parseAndNormalizeQuery } from '../src/api/logs/queryValidation';

describe('parseAndNormalizeQuery', () => {
    it('normalizes valid relative query', () => {
        const now = new Date('2026-02-24T12:00:00.000Z');
        const result = parseAndNormalizeQuery({
            requestQuery: {},
            requestContent: {
                since: '15m',
                level: 'error',
                search: 'timeout',
                limit: 250,
            },
            defaultTimeRange: '15m',
            maxTimeWindowHours: 24,
            maxLinesPerQuery: 2000,
            now,
        });

        expect('query' in result).toBe(true);
        if ('query' in result) {
            expect(result.query.level).toBe('error');
            expect(result.query.search).toBe('timeout');
            expect(result.query.limit).toBe(250);
            expect(result.query.end.toISOString()).toBe(now.toISOString());
            expect(result.query.start.toISOString()).toBe('2026-02-24T11:45:00.000Z');
        }
    });

    it('rejects unknown query keys', () => {
        const result = parseAndNormalizeQuery({
            requestQuery: { foo: 'bar' },
            requestContent: {},
            defaultTimeRange: '15m',
            maxTimeWindowHours: 24,
            maxLinesPerQuery: 2000,
        });

        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error).toContain('Unsupported query parameters');
        }
    });

    it('ignores unknown requestQuery keys when requestContent is provided', () => {
        const now = new Date('2026-02-24T12:00:00.000Z');
        const result = parseAndNormalizeQuery({
            requestQuery: { roomId: 'room-1', source: 'slash' },
            requestContent: {
                since: '15m',
                limit: 100,
            },
            defaultTimeRange: '15m',
            maxTimeWindowHours: 24,
            maxLinesPerQuery: 2000,
            now,
        });

        expect('query' in result).toBe(true);
        if ('query' in result) {
            expect(result.query.limit).toBe(100);
            expect(result.query.end.toISOString()).toBe(now.toISOString());
            expect(result.query.start.toISOString()).toBe('2026-02-24T11:45:00.000Z');
        }
    });

    it('rejects missing end when start is present', () => {
        const result = parseAndNormalizeQuery({
            requestQuery: {},
            requestContent: {
                start: '2026-02-24T10:00:00.000Z',
            },
            defaultTimeRange: '15m',
            maxTimeWindowHours: 24,
            maxLinesPerQuery: 2000,
        });

        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error).toContain('Both start and end must be provided together');
        }
    });

    it('rejects limit above configured max', () => {
        const result = parseAndNormalizeQuery({
            requestQuery: {},
            requestContent: {
                since: '15m',
                limit: 5001,
            },
            defaultTimeRange: '15m',
            maxTimeWindowHours: 24,
            maxLinesPerQuery: 2000,
        });

        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error).toContain('Requested limit exceeds max lines per query');
        }
    });
});
