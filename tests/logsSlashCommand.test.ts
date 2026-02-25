import { describe, expect, it } from 'bun:test';

import { LogsSlashCommand } from '../src/commands/LogsSlashCommand';

describe('LogsSlashCommand argument parsing', () => {
    const command = new LogsSlashCommand('test-app-id') as any;

    it('applies preset defaults and lets explicit args override them', () => {
        const parsed = command.parseArguments(['preset=incident', 'level=warn', 'search=gateway', 'limit=900']);

        expect(parsed.preset).toBe('incident');
        expect(parsed.since).toBe('30m');
        expect(parsed.level).toBe('warn');
        expect(parsed.search).toBe('gateway');
        expect(parsed.limit).toBe(900);
        expect(parsed.autorun).toBe(true);
    });

    it('rejects partial absolute time window', () => {
        const parsed = command.parseArguments(['start=2026-02-24T10:00:00Z']);

        expect(parsed.start).toBeUndefined();
        expect(parsed.end).toBeUndefined();
        expect(parsed.warnings.join(' ')).toContain('Both start and end are required');
    });

    it('warns on unknown preset', () => {
        const parsed = command.parseArguments(['preset=not-real']);

        expect(parsed.preset).toBeUndefined();
        expect(parsed.warnings.join(' ')).toContain('Unknown preset');
    });

    it('treats free tokens as search fallback', () => {
        const parsed = command.parseArguments(['gateway', 'timeout']);

        expect(parsed.search).toBe('gateway timeout');
        expect(parsed.autorun).toBe(true);
    });

    it('maps numeric log levels from JSON lines to semantic levels', () => {
        expect(command.detectLevel('{"level":20,"msg":"debug line"}', {})).toBe('debug');
        expect(command.detectLevel('{"level":35,"msg":"request log"}', {})).toBe('info');
        expect(command.detectLevel('{"level":50,"msg":"fatal-ish"}', {})).toBe('error');
    });
});
