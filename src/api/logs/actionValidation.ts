export type LogsActionType = 'share' | 'incident_draft' | 'thread_note';

type ParsedContext = {
    source?: string;
    preset?: string;
    roomId?: string;
    roomName?: string;
    threadId?: string;
    search?: string;
    requestedLevel?: string;
};

export type ParsedLogActionEntry = {
    timestamp: string;
    level: string;
    message: string;
    labels: Record<string, string>;
};

export type ParsedLogActionRequest = {
    action: LogsActionType;
    targetRoomId: string;
    targetThreadId?: string;
    entry: ParsedLogActionEntry;
    context: ParsedContext;
};

const MAX_ROOM_ID_LENGTH = 128;
const MAX_THREAD_ID_LENGTH = 128;
const MAX_TIMESTAMP_LENGTH = 80;
const MAX_LEVEL_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 1800;
const MAX_CONTEXT_LENGTH = 200;
const MAX_LABELS = 20;
const MAX_LABEL_KEY_LENGTH = 80;
const MAX_LABEL_VALUE_LENGTH = 200;

const ACTIONS = new Set<LogsActionType>(['share', 'incident_draft', 'thread_note']);
const TOP_LEVEL_KEYS = new Set(['action', 'targetRoomId', 'targetThreadId', 'entry', 'context']);
const ENTRY_KEYS = new Set(['timestamp', 'level', 'message', 'labels']);
const CONTEXT_KEYS = new Set(['source', 'preset', 'roomId', 'roomName', 'threadId', 'search', 'requestedLevel']);

export const parseAndNormalizeLogActionRequest = (
    payload: unknown,
): { request: ParsedLogActionRequest } | { error: string; details?: unknown } => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { error: 'Action payload must be a JSON object.' };
    }

    const objectPayload = payload as Record<string, unknown>;
    const unknownTopLevel = Object.keys(objectPayload).filter((key) => !TOP_LEVEL_KEYS.has(key));
    if (unknownTopLevel.length > 0) {
        return {
            error: 'Action payload contains unsupported fields.',
            details: { unknownFields: unknownTopLevel },
        };
    }

    const actionRaw = typeof objectPayload.action === 'string' ? objectPayload.action.trim() : '';
    if (!ACTIONS.has(actionRaw as LogsActionType)) {
        return {
            error: 'Invalid action. Expected one of: share, incident_draft, thread_note.',
            details: { action: objectPayload.action },
        };
    }

    const targetRoomId = sanitizeString(objectPayload.targetRoomId, MAX_ROOM_ID_LENGTH);
    if (!targetRoomId) {
        return { error: 'targetRoomId is required.' };
    }

    const targetThreadId = sanitizeString(objectPayload.targetThreadId, MAX_THREAD_ID_LENGTH) || undefined;

    const entryResult = parseEntry(objectPayload.entry);
    if ('error' in entryResult) {
        return entryResult;
    }

    const contextResult = parseContext(objectPayload.context);
    if ('error' in contextResult) {
        return contextResult;
    }

    return {
        request: {
            action: actionRaw as LogsActionType,
            targetRoomId,
            targetThreadId,
            entry: entryResult.entry,
            context: contextResult.context,
        },
    };
};

export const composeActionMessage = (request: ParsedLogActionRequest): string => {
    if (request.action === 'incident_draft') {
        return composeIncidentDraft(request);
    }
    if (request.action === 'thread_note') {
        return composeThreadNote(request);
    }

    return composeSharedLogMessage(request);
};

const parseEntry = (raw: unknown): { entry: ParsedLogActionEntry } | { error: string; details?: unknown } => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'entry is required and must be an object.' };
    }

    const rawEntry = raw as Record<string, unknown>;
    const unknownKeys = Object.keys(rawEntry).filter((key) => !ENTRY_KEYS.has(key));
    if (unknownKeys.length > 0) {
        return {
            error: 'entry contains unsupported fields.',
            details: { unknownFields: unknownKeys },
        };
    }

    const timestamp = sanitizeString(rawEntry.timestamp, MAX_TIMESTAMP_LENGTH);
    const level = sanitizeString(rawEntry.level, MAX_LEVEL_LENGTH).toLowerCase();
    const message = sanitizeString(rawEntry.message, MAX_MESSAGE_LENGTH);

    if (!timestamp) {
        return { error: 'entry.timestamp is required.' };
    }
    if (!level) {
        return { error: 'entry.level is required.' };
    }
    if (!message) {
        return { error: 'entry.message is required.' };
    }

    const labelsResult = parseLabels(rawEntry.labels);
    if ('error' in labelsResult) {
        return labelsResult;
    }

    return {
        entry: {
            timestamp,
            level,
            message,
            labels: labelsResult.labels,
        },
    };
};

const parseLabels = (raw: unknown): { labels: Record<string, string> } | { error: string } => {
    if (raw === undefined || raw === null) {
        return { labels: {} };
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'entry.labels must be an object map.' };
    }

    const labels: Record<string, string> = {};
    const entries = Object.entries(raw).slice(0, MAX_LABELS);
    for (const [keyRaw, valueRaw] of entries) {
        const key = sanitizeString(keyRaw, MAX_LABEL_KEY_LENGTH);
        const value = sanitizeString(valueRaw, MAX_LABEL_VALUE_LENGTH);
        if (!key || !value) {
            continue;
        }

        labels[key] = value;
    }

    return { labels };
};

const parseContext = (raw: unknown): { context: ParsedContext } | { error: string; details?: unknown } => {
    if (raw === undefined || raw === null) {
        return { context: {} };
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'context must be an object when provided.' };
    }

    const rawContext = raw as Record<string, unknown>;
    const unknownKeys = Object.keys(rawContext).filter((key) => !CONTEXT_KEYS.has(key));
    if (unknownKeys.length > 0) {
        return {
            error: 'context contains unsupported fields.',
            details: { unknownFields: unknownKeys },
        };
    }

    return {
        context: {
            source: sanitizeString(rawContext.source, MAX_CONTEXT_LENGTH) || undefined,
            preset: sanitizeString(rawContext.preset, MAX_CONTEXT_LENGTH) || undefined,
            roomId: sanitizeString(rawContext.roomId, MAX_CONTEXT_LENGTH) || undefined,
            roomName: sanitizeString(rawContext.roomName, MAX_CONTEXT_LENGTH) || undefined,
            threadId: sanitizeString(rawContext.threadId, MAX_CONTEXT_LENGTH) || undefined,
            search: sanitizeString(rawContext.search, MAX_CONTEXT_LENGTH) || undefined,
            requestedLevel: sanitizeString(rawContext.requestedLevel, MAX_CONTEXT_LENGTH) || undefined,
        },
    };
};

const composeSharedLogMessage = (request: ParsedLogActionRequest): string => {
    const lines = [
        '*Log Entry Shared from Logs Viewer*',
        `- Time: ${formatTimestamp(request.entry.timestamp)}`,
        `- Level: \`${request.entry.level}\``,
    ];

    if (request.context.source) {
        lines.push(`- Source: ${request.context.source}`);
    }
    if (request.context.preset) {
        lines.push(`- Preset: ${request.context.preset}`);
    }
    if (request.context.search) {
        lines.push(`- Search: \`${request.context.search}\``);
    }

    lines.push('');
    lines.push('*Message*');
    lines.push(toQuoteBlock(request.entry.message));

    const labels = formatLabels(request.entry.labels);
    if (labels) {
        lines.push('');
        lines.push(`*Labels* ${labels}`);
    }

    return lines.join('\n');
};

const composeIncidentDraft = (request: ParsedLogActionRequest): string => {
    const summary = deriveSummary(request.entry.message);
    const lines = [
        '*:rotating_light: Incident Draft (Logs Viewer)*',
        `- Trigger time: ${formatTimestamp(request.entry.timestamp)}`,
        `- Suspected severity: \`${request.entry.level}\``,
        `- Suggested summary: ${summary}`,
        '- Impact: _fill in_',
        '- Scope: _fill in_',
        '- Owner: _assign_',
    ];

    if (request.context.preset) {
        lines.push(`- Preset context: ${request.context.preset}`);
    }
    if (request.context.source) {
        lines.push(`- Source context: ${request.context.source}`);
    }

    lines.push('');
    lines.push('*Evidence*');
    lines.push(toQuoteBlock(request.entry.message));

    const labels = formatLabels(request.entry.labels);
    if (labels) {
        lines.push(`- Labels: ${labels}`);
    }

    lines.push('');
    lines.push('*Next actions*');
    lines.push('1. Confirm blast radius');
    lines.push('2. Link related alerts and remediation changes');
    lines.push('3. Post updates in the incident thread');

    return lines.join('\n');
};

const composeThreadNote = (request: ParsedLogActionRequest): string => {
    const lines = [
        '*Thread Note (Logs Viewer)*',
        `- Logged at: ${formatTimestamp(request.entry.timestamp)}`,
        `- Level: \`${request.entry.level}\``,
    ];

    if (request.context.source) {
        lines.push(`- Source: ${request.context.source}`);
    }
    if (request.context.search) {
        lines.push(`- Search context: \`${request.context.search}\``);
    }
    if (request.context.preset) {
        lines.push(`- Preset context: ${request.context.preset}`);
    }

    lines.push('');
    lines.push('*Note*');
    lines.push(toQuoteBlock(request.entry.message));

    const labels = formatLabels(request.entry.labels);
    if (labels) {
        lines.push('');
        lines.push(`*Labels* ${labels}`);
    }

    return lines.join('\n');
};

const sanitizeString = (value: unknown, maxLength: number): string => {
    if (typeof value === 'string') {
        return value.trim().slice(0, maxLength);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value).trim().slice(0, maxLength);
    }

    return '';
};

const formatLabels = (labels: Record<string, string>): string => {
    const pairs = Object.entries(labels).slice(0, MAX_LABELS);
    if (pairs.length === 0) {
        return '';
    }

    return pairs.map(([key, value]) => `\`${key}=${value}\``).join(' ');
};

const toQuoteBlock = (message: string): string => {
    const sanitized = message.replace(/\r/g, '\n');
    const lines = sanitized.split('\n').slice(0, 12).map((line) => `> ${line}`);
    if (sanitized.split('\n').length > 12) {
        lines.push('> ...(truncated)');
    }
    return lines.join('\n');
};

const deriveSummary = (message: string): string => {
    const normalized = message.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return 'Log-triggered incident investigation';
    }

    return normalized.slice(0, 140);
};

const formatTimestamp = (timestamp: string): string => {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return timestamp;
    }

    return parsed.toISOString();
};
