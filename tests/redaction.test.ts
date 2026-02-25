import { describe, expect, it } from 'bun:test';

import { redactLogMessage } from '../src/security/redaction';

describe('redactLogMessage', () => {
    it('redacts sensitive values when enabled', () => {
        const message = 'Authorization: Bearer abcdef123456 user=test@example.com password=super-secret';
        const result = redactLogMessage(message, {
            enabled: true,
            replacement: '[MASKED]',
        });

        expect(result.redacted).toBe(true);
        expect(result.redactionCount).toBeGreaterThan(0);
        expect(result.message).toContain('[MASKED]');
        expect(result.message).not.toContain('test@example.com');
        expect(result.message).not.toContain('super-secret');
    });

    it('keeps message untouched when disabled', () => {
        const message = 'Authorization: Bearer abcdef123456';
        const result = redactLogMessage(message, {
            enabled: false,
            replacement: '[MASKED]',
        });

        expect(result.redacted).toBe(false);
        expect(result.redactionCount).toBe(0);
        expect(result.message).toBe(message);
    });
});
