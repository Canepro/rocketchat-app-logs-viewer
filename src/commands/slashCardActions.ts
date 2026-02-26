export type QueryLevel = 'error' | 'warn' | 'info' | 'debug';

export const SLASH_CARD_ACTION = {
    COPY_SAMPLE: 'logs_slash_copy_sample',
    SHARE_SAMPLE: 'logs_slash_share_sample',
    SHARE_ELSEWHERE: 'logs_slash_share_elsewhere',
} as const;

type SlashCardActionId = (typeof SLASH_CARD_ACTION)[keyof typeof SLASH_CARD_ACTION];

export type SlashCardSampleLine = {
    level: QueryLevel | 'unknown';
    text: string;
};

export type SlashCardActionPayload = {
    version: 1;
    roomId: string;
    roomName: string;
    threadId?: string;
    sourceMode: 'loki' | 'app_logs';
    windowLabel: string;
    filterSummary: string;
    preset: string;
    snapshotId?: string;
    sampleTotalCount?: number;
    sampleOutput: Array<SlashCardSampleLine>;
};

const MAX_ROOM_ID_LENGTH = 128;
const MAX_ROOM_NAME_LENGTH = 120;
const MAX_THREAD_ID_LENGTH = 128;
const MAX_WINDOW_LABEL_LENGTH = 140;
const MAX_FILTER_SUMMARY_LENGTH = 180;
const MAX_PRESET_LENGTH = 40;
const MAX_SNAPSHOT_ID_LENGTH = 80;
const MAX_SAMPLE_LINES = 50;
const MAX_SAMPLE_TEXT_LENGTH = 220;
const LEVELS = new Set<QueryLevel | 'unknown'>(['error', 'warn', 'info', 'debug', 'unknown']);

export const isSlashCardActionId = (value: string | undefined): value is SlashCardActionId =>
    value === SLASH_CARD_ACTION.COPY_SAMPLE
        || value === SLASH_CARD_ACTION.SHARE_SAMPLE
        || value === SLASH_CARD_ACTION.SHARE_ELSEWHERE;

export const encodeSlashCardActionPayload = (payload: SlashCardActionPayload): string =>
    // Keep button payload compact and opaque; handler re-validates every field after decode.
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

export const decodeSlashCardActionPayload = (raw: string | undefined): SlashCardActionPayload | undefined => {
    if (!raw || typeof raw !== 'string') {
        return undefined;
    }

    try {
        const decoded = Buffer.from(raw, 'base64url').toString('utf8');
        const parsed = JSON.parse(decoded) as Partial<SlashCardActionPayload>;
        return sanitizePayload(parsed);
    } catch {
        return undefined;
    }
};

export const formatSampleLines = (
    payload: SlashCardActionPayload,
    options?: { withIndex?: boolean; maxLines?: number },
): Array<string> => {
    const withIndex = options?.withIndex ?? false;
    const safeMaxLines = typeof options?.maxLines === 'number' && Number.isFinite(options.maxLines)
        ? Math.max(1, Math.floor(options.maxLines))
        : payload.sampleOutput.length;

    return payload.sampleOutput.slice(0, safeMaxLines).map((item, index) => {
        const prefix = withIndex ? `${String(index + 1).padStart(2, '0')} ` : '';
        return `${prefix}[${item.level}] ${item.text}`;
    });
};

const sanitizePayload = (raw: Partial<SlashCardActionPayload>): SlashCardActionPayload | undefined => {
    // Version gate keeps backward compatibility when payload structure evolves.
    if (raw.version !== 1) {
        return undefined;
    }

    const roomId = sanitizeString(raw.roomId, MAX_ROOM_ID_LENGTH);
    const roomName = sanitizeString(raw.roomName, MAX_ROOM_NAME_LENGTH);
    const sourceMode = raw.sourceMode === 'app_logs' ? 'app_logs' : raw.sourceMode === 'loki' ? 'loki' : undefined;
    const windowLabel = sanitizeString(raw.windowLabel, MAX_WINDOW_LABEL_LENGTH);
    const filterSummary = sanitizeString(raw.filterSummary, MAX_FILTER_SUMMARY_LENGTH);
    const preset = sanitizeString(raw.preset, MAX_PRESET_LENGTH) || 'none';
    const snapshotId = sanitizeString(raw.snapshotId, MAX_SNAPSHOT_ID_LENGTH) || undefined;
    const sampleTotalCount = sanitizeSampleTotalCount(raw.sampleTotalCount);

    if (!roomId || !roomName || !sourceMode || !windowLabel || !filterSummary) {
        return undefined;
    }

    const threadId = sanitizeString(raw.threadId, MAX_THREAD_ID_LENGTH) || undefined;
    const sampleOutput = sanitizeSampleOutput(raw.sampleOutput);

    return {
        version: 1,
        roomId,
        roomName,
        threadId,
        sourceMode,
        windowLabel,
        filterSummary,
        preset,
        snapshotId,
        sampleTotalCount,
        sampleOutput,
    };
};

const sanitizeSampleOutput = (raw: unknown): Array<SlashCardSampleLine> => {
    if (!Array.isArray(raw)) {
        return [];
    }

    const next: Array<SlashCardSampleLine> = [];
    // Never trust client-provided action value; clamp line count and text length.
    for (const candidate of raw.slice(0, MAX_SAMPLE_LINES)) {
        if (!candidate || typeof candidate !== 'object') {
            continue;
        }

        const record = candidate as Partial<SlashCardSampleLine>;
        const level = typeof record.level === 'string' && LEVELS.has(record.level as QueryLevel | 'unknown')
            ? (record.level as QueryLevel | 'unknown')
            : 'unknown';
        const text = sanitizeString(record.text, MAX_SAMPLE_TEXT_LENGTH);
        if (!text) {
            continue;
        }

        next.push({ level, text });
    }

    return next;
};

const sanitizeString = (value: unknown, maxLength: number): string => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

const sanitizeSampleTotalCount = (value: unknown): number | undefined => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return undefined;
    }

    return Math.floor(parsed);
};
