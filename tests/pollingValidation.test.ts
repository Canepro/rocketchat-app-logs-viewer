import { describe, expect, it } from 'bun:test';

import {
    DEFAULT_POLLING_INTERVAL_SECONDS,
    MAX_POLLING_INTERVAL_SECONDS,
    MIN_POLLING_INTERVAL_SECONDS,
    parsePollingIntervalSeconds,
} from '../web/src/lib/polling';

describe('parsePollingIntervalSeconds', () => {
    it('parses valid values and floors decimals', () => {
        expect(parsePollingIntervalSeconds('20')).toBe(20);
        expect(parsePollingIntervalSeconds(12.9)).toBe(12);
    });

    it('clamps values into safe bounds', () => {
        expect(parsePollingIntervalSeconds('1')).toBe(MIN_POLLING_INTERVAL_SECONDS);
        expect(parsePollingIntervalSeconds('9999')).toBe(MAX_POLLING_INTERVAL_SECONDS);
    });

    it('returns undefined for invalid values', () => {
        expect(parsePollingIntervalSeconds('')).toBeUndefined();
        expect(parsePollingIntervalSeconds('abc')).toBeUndefined();
        expect(parsePollingIntervalSeconds(0)).toBeUndefined();
        expect(parsePollingIntervalSeconds(-10)).toBeUndefined();
    });

    it('keeps default in safe range', () => {
        expect(DEFAULT_POLLING_INTERVAL_SECONDS).toBeGreaterThanOrEqual(MIN_POLLING_INTERVAL_SECONDS);
        expect(DEFAULT_POLLING_INTERVAL_SECONDS).toBeLessThanOrEqual(MAX_POLLING_INTERVAL_SECONDS);
    });
});
