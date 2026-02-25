import { describe, expect, it } from 'bun:test';

import { parseSavedViewsListQuery, parseSavedViewsMutation } from '../src/api/logs/viewsValidation';

describe('parseSavedViewsListQuery', () => {
    it('applies defaults and clamps limit', () => {
        const fallback = parseSavedViewsListQuery(undefined, { defaultLimit: 40, maxLimit: 50 });
        const high = parseSavedViewsListQuery({ limit: 999 }, { defaultLimit: 40, maxLimit: 50 });

        expect(fallback.limit).toBe(40);
        expect(high.limit).toBe(50);
    });
});

describe('parseSavedViewsMutation', () => {
    it('parses create mutation', () => {
        const parsed = parseSavedViewsMutation({
            action: 'create',
            name: 'Last errors',
            query: {
                timeMode: 'relative',
                since: '15m',
                limit: 200,
                level: 'error',
            },
        });

        expect('mutation' in parsed).toBe(true);
        if ('mutation' in parsed) {
            expect(parsed.mutation.action).toBe('create');
            expect(parsed.mutation.name).toBe('Last errors');
            expect(parsed.mutation.query.timeMode).toBe('relative');
        }
    });

    it('rejects update mutation with no changes', () => {
        const parsed = parseSavedViewsMutation({
            action: 'update',
            id: 'sv_123',
        });

        expect(parsed).toEqual({
            error: 'update action requires name and/or query.',
        });
    });

    it('parses delete mutation', () => {
        const parsed = parseSavedViewsMutation({
            action: 'delete',
            id: 'sv_123',
        });

        expect(parsed).toEqual({
            mutation: {
                action: 'delete',
                id: 'sv_123',
            },
        });
    });

    it('rejects invalid absolute range', () => {
        const parsed = parseSavedViewsMutation({
            action: 'create',
            name: 'Broken absolute',
            query: {
                timeMode: 'absolute',
                start: '2026-02-25T10:00:00.000Z',
                end: '2026-02-25T09:00:00.000Z',
                limit: 100,
            },
        });

        expect(parsed).toEqual({
            error: 'query.start must be before query.end.',
        });
    });
});
