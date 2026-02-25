export type QueryLevel = 'error' | 'warn' | 'info' | 'debug';

export type QueryPayload = {
    start?: unknown;
    end?: unknown;
    since?: unknown;
    limit?: unknown;
    level?: unknown;
    search?: unknown;
};

export type NormalizedQuery = {
    start: Date;
    end: Date;
    limit: number;
    level?: QueryLevel;
    search?: string;
};

export type QueryValidationSuccess = {
    query: NormalizedQuery;
};

export type QueryValidationError = {
    error: string;
    details?: unknown;
};

export type QueryValidationResult = QueryValidationSuccess | QueryValidationError;

const ALLOWED_QUERY_KEYS = new Set(['start', 'end', 'since', 'limit', 'level', 'search']);
const ALLOWED_LEVELS = new Set<QueryLevel>(['error', 'warn', 'info', 'debug']);

export const parseAndNormalizeQuery = (args: {
    requestQuery: Record<string, unknown>;
    requestContent: unknown;
    defaultTimeRange: string;
    maxTimeWindowHours: number;
    maxLinesPerQuery: number;
    now?: Date;
}): QueryValidationResult => {
    const payloadResult = parsePayload(args.requestQuery, args.requestContent);
    if ('error' in payloadResult) {
        return payloadResult;
    }

    return normalizeQuery(payloadResult.payload, {
        defaultTimeRange: args.defaultTimeRange,
        maxTimeWindowHours: args.maxTimeWindowHours,
        maxLinesPerQuery: args.maxLinesPerQuery,
        now: args.now || new Date(),
    });
};

const parsePayload = (requestQuery: Record<string, unknown>, requestContent: unknown): { payload: QueryPayload } | QueryValidationError => {
    const content = readObjectContent(requestContent);
    if ('error' in content) {
        return content;
    }

    const contentKeys = Object.keys(content.value);
    // Prefer explicit request body payload when provided; this avoids unrelated URL query context
    // leaking into query validation for POST /query requests.
    const selectedPayload = contentKeys.length > 0 ? content.value : requestQuery;

    const unknownKeys = Object.keys(selectedPayload).filter((key) => !ALLOWED_QUERY_KEYS.has(key));
    if (unknownKeys.length > 0) {
        return {
            error: 'Unsupported query parameters.',
            details: { unknownKeys, allowedKeys: Array.from(ALLOWED_QUERY_KEYS) },
        };
    }

    return { payload: selectedPayload };
};

const normalizeQuery = (
    payload: QueryPayload,
    opts: { defaultTimeRange: string; maxTimeWindowHours: number; maxLinesPerQuery: number; now: Date },
): QueryValidationResult => {
    const startProvided = payload.start !== undefined;
    const endProvided = payload.end !== undefined;
    const sinceProvided = payload.since !== undefined;

    if ((startProvided && !endProvided) || (!startProvided && endProvided)) {
        return { error: 'Both start and end must be provided together.' };
    }
    if (sinceProvided && (startProvided || endProvided)) {
        return { error: 'Use either start/end or since, not both.' };
    }

    const limit = parsePositiveInteger(payload.limit ?? 500);
    if ('error' in limit) {
        return limit;
    }
    if (limit.value > opts.maxLinesPerQuery) {
        return {
            error: `Requested limit exceeds max lines per query (${opts.maxLinesPerQuery}).`,
        };
    }

    let level: QueryLevel | undefined;
    if (payload.level !== undefined) {
        if (typeof payload.level !== 'string') {
            return { error: 'level must be a string.' };
        }
        const normalizedLevel = payload.level.trim().toLowerCase() as QueryLevel;
        if (!ALLOWED_LEVELS.has(normalizedLevel)) {
            return {
                error: 'Invalid level filter.',
                details: { allowed: Array.from(ALLOWED_LEVELS) },
            };
        }
        level = normalizedLevel;
    }

    let search: string | undefined;
    if (payload.search !== undefined) {
        if (typeof payload.search !== 'string') {
            return { error: 'search must be a string.' };
        }
        search = payload.search.trim();
        if (search.length > 512) {
            return { error: 'search is too long. Maximum 512 characters.' };
        }
        if (!search) {
            search = undefined;
        }
    }

    let start: Date;
    let end: Date;

    if (startProvided && endProvided) {
        const parsedStart = parseTimestamp(payload.start);
        const parsedEnd = parseTimestamp(payload.end);
        if ('error' in parsedStart) {
            return parsedStart;
        }
        if ('error' in parsedEnd) {
            return parsedEnd;
        }
        start = parsedStart.value;
        end = parsedEnd.value;
    } else {
        const durationInput = sinceProvided ? payload.since : opts.defaultTimeRange;
        const parsedDuration = parseDuration(durationInput);
        if ('error' in parsedDuration) {
            return parsedDuration;
        }
        end = opts.now;
        start = new Date(end.getTime() - parsedDuration.value);
    }

    if (start.getTime() >= end.getTime()) {
        return { error: 'start must be before end.' };
    }

    const maxWindowMs = opts.maxTimeWindowHours * 60 * 60 * 1000;
    const requestedWindowMs = end.getTime() - start.getTime();
    if (requestedWindowMs > maxWindowMs) {
        return {
            error: `Requested time window exceeds max of ${opts.maxTimeWindowHours} hours.`,
        };
    }

    if (end.getTime() > opts.now.getTime() + 1000) {
        return { error: 'end time cannot be in the future.' };
    }

    return {
        query: {
            start,
            end,
            limit: limit.value,
            level,
            search,
        },
    };
};

const parseDuration = (value: unknown): { value: number } | QueryValidationError => {
    if (typeof value !== 'string') {
        return { error: 'since/default time range must be a string duration like 15m, 1h, 24h.' };
    }

    const match = value.trim().match(/^(\d+)\s*([smhdw])$/i);
    if (!match) {
        return { error: 'Invalid duration format. Use number + unit (s, m, h, d, w).' };
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
        return { error: 'Duration amount must be a positive number.' };
    }

    const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
    };

    return { value: amount * multipliers[unit] };
};

const parseTimestamp = (value: unknown): { value: Date } | QueryValidationError => {
    if (typeof value === 'number') {
        return parseNumericTimestamp(value);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return { error: 'Timestamp cannot be empty.' };
        }
        if (/^\d+$/.test(trimmed)) {
            return parseNumericTimestamp(Number(trimmed));
        }

        const parsed = new Date(trimmed);
        if (Number.isNaN(parsed.getTime())) {
            return { error: `Invalid timestamp: ${value}` };
        }
        return { value: parsed };
    }

    return { error: 'Timestamp must be a number or ISO date string.' };
};

const parseNumericTimestamp = (value: number): { value: Date } | QueryValidationError => {
    if (!Number.isFinite(value)) {
        return { error: 'Invalid numeric timestamp.' };
    }

    let msValue: number;
    if (Math.abs(value) > 1e14) {
        msValue = value / 1e6;
    } else if (Math.abs(value) > 1e11) {
        msValue = value;
    } else {
        msValue = value * 1000;
    }

    const parsed = new Date(msValue);
    if (Number.isNaN(parsed.getTime())) {
        return { error: `Invalid numeric timestamp: ${value}` };
    }

    return { value: parsed };
};

const parsePositiveInteger = (value: unknown): { value: number } | QueryValidationError => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return { error: 'limit must be a positive integer.' };
    }
    return { value: Math.floor(numeric) };
};

const readObjectContent = (content: unknown): { value: Record<string, unknown> } | QueryValidationError => {
    if (content === undefined || content === null || content === '') {
        return { value: {} };
    }

    if (typeof content === 'string') {
        try {
            const parsed = JSON.parse(content);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { error: 'Request JSON body must be an object.' };
            }
            return { value: parsed as Record<string, unknown> };
        } catch (error) {
            return { error: 'Failed to parse request body as JSON object.', details: String(error) };
        }
    }

    if (typeof content !== 'object' || Array.isArray(content)) {
        return { error: 'Request body must be a JSON object.' };
    }

    return { value: content as Record<string, unknown> };
};
