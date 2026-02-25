import { describe, expect, it } from 'bun:test';

import { parseTargetsQuery } from '../src/api/logs/targetsValidation';

describe('parseTargetsQuery', () => {
    it('applies defaults when query is empty', () => {
        const parsed = parseTargetsQuery(undefined, {
            defaultLimit: 80,
            maxLimit: 200,
            maxSearchLength: 80,
        });

        expect(parsed.limit).toBe(80);
        expect(parsed.search).toBeUndefined();
    });

    it('clamps limit into configured bounds', () => {
        const high = parseTargetsQuery({ limit: '9999' }, { defaultLimit: 80, maxLimit: 200 });
        const low = parseTargetsQuery({ limit: '0' }, { defaultLimit: 80, maxLimit: 200 });

        expect(high.limit).toBe(200);
        expect(low.limit).toBe(1);
    });

    it('normalizes and truncates search text', () => {
        const parsed = parseTargetsQuery(
            {
                search: '   room-name-that-is-way-too-long   ',
            },
            { defaultLimit: 80, maxLimit: 200, maxSearchLength: 8 },
        );

        expect(parsed.search).toBe('room-name-');
    });
});
