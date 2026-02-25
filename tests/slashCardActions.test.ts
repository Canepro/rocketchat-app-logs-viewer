import { describe, expect, it } from 'bun:test';

import {
    decodeSlashCardActionPayload,
    encodeSlashCardActionPayload,
    formatSampleLines,
    SLASH_CARD_ACTION,
    isSlashCardActionId,
    SlashCardActionPayload,
} from '../src/commands/slashCardActions';

describe('slashCardActions helpers', () => {
    it('round-trips payload encode/decode with bounded sample output', () => {
        const payload: SlashCardActionPayload = {
            version: 1,
            roomId: 'room-1',
            roomName: 'Support_Stuff',
            sourceMode: 'loki',
            windowLabel: 'last 15m',
            filterSummary: 'since=15m, limit=200',
            preset: 'none',
            sampleOutput: [
                { level: 'error', text: '2026-02-25T10:00:00.000Z Connection ended' },
            ],
        };

        const encoded = encodeSlashCardActionPayload(payload);
        const decoded = decodeSlashCardActionPayload(encoded);

        expect(decoded).toBeDefined();
        expect(decoded?.roomId).toBe('room-1');
        expect(decoded?.sampleOutput.length).toBe(1);
        expect(formatSampleLines(decoded!)[0]).toContain('[error]');
    });

    it('rejects invalid payloads and unknown action ids', () => {
        expect(decodeSlashCardActionPayload(undefined)).toBeUndefined();
        expect(decodeSlashCardActionPayload('not-base64')).toBeUndefined();
        expect(isSlashCardActionId('random')).toBe(false);
        expect(isSlashCardActionId(SLASH_CARD_ACTION.COPY_SAMPLE)).toBe(true);
    });
});
