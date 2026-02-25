import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_ASSOC_PREFIX = 'rate-limit:user:';
const AUDIT_ASSOC_KEY = 'audit:logs-query';

type RateLimitRecord = {
    windowStartMs: number;
    count: number;
    updatedAt: string;
};

export type AuditEntry = {
    action:
        | 'query'
        | 'query_denied'
        | 'share'
        | 'share_denied'
        | 'incident_draft'
        | 'incident_draft_denied'
        | 'thread_note'
        | 'thread_note_denied'
        | 'saved_view_list'
        | 'saved_view_list_denied'
        | 'saved_view_create'
        | 'saved_view_create_denied'
        | 'saved_view_update'
        | 'saved_view_update_denied'
        | 'saved_view_delete'
        | 'saved_view_delete_denied';
    userId: string;
    timestamp: string;
    outcome: 'allowed' | 'denied';
    reason?: string;
    scope?: Record<string, unknown>;
};

type AuditRecord = {
    updatedAt: string;
    entries: Array<AuditEntry>;
};

export type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds?: number;
};

export const parseAllowedRoles = (rawValue: unknown): Array<string> => {
    if (typeof rawValue !== 'string') {
        return ['admin'];
    }

    const parsed = rawValue
        .split(',')
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);

    return parsed.length > 0 ? parsed : ['admin'];
};

export const hasAnyAllowedRole = (userRoles: Array<string> | undefined, allowedRoles: Array<string>): boolean => {
    if (!Array.isArray(userRoles) || userRoles.length === 0) {
        return false;
    }

    const normalized = new Set(userRoles.map((role) => role.toLowerCase()));
    return allowedRoles.some((role) => normalized.has(role));
};

export const consumeRateLimitToken = async (
    read: IRead,
    persistence: IPersistence,
    userId: string,
    maxPerMinute: number,
): Promise<RateLimitResult> => {
    const now = Date.now();
    const safeLimit = Math.max(1, Math.floor(maxPerMinute));
    const assoc = new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, `${RATE_LIMIT_ASSOC_PREFIX}${userId}`);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseRateLimitRecord(current[0], now);

    if (now - record.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
        record.windowStartMs = now;
        record.count = 0;
    }

    record.count += 1;
    record.updatedAt = new Date(now).toISOString();

    await persistence.updateByAssociation(assoc, record, true);

    if (record.count > safeLimit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((record.windowStartMs + RATE_LIMIT_WINDOW_MS - now) / 1000));
        return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds,
        };
    }

    return {
        allowed: true,
        remaining: Math.max(0, safeLimit - record.count),
    };
};

export const appendAuditEntry = async (
    read: IRead,
    persistence: IPersistence,
    entry: Omit<AuditEntry, 'timestamp'>,
    retentionDays: number,
    maxEntries: number,
): Promise<void> => {
    const now = Date.now();
    const safeRetentionDays = Math.max(1, Math.floor(retentionDays));
    const safeMaxEntries = Math.max(100, Math.floor(maxEntries));
    const cutoffMs = now - safeRetentionDays * 24 * 60 * 60 * 1000;
    const assoc = new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, AUDIT_ASSOC_KEY);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseAuditRecord(current[0]);

    const retained = record.entries.filter((item) => {
        const ts = Date.parse(item.timestamp);
        return Number.isFinite(ts) && ts >= cutoffMs;
    });

    retained.push({
        ...entry,
        timestamp: new Date(now).toISOString(),
    });

    if (retained.length > safeMaxEntries) {
        retained.splice(0, retained.length - safeMaxEntries);
    }

    const nextRecord: AuditRecord = {
        updatedAt: new Date(now).toISOString(),
        entries: retained,
    };
    await persistence.updateByAssociation(assoc, nextRecord, true);
};

export const readAuditEntries = async (
    read: IRead,
    options: { offset: number; limit: number },
): Promise<{ entries: Array<AuditEntry>; total: number }> => {
    const assoc = new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, AUDIT_ASSOC_KEY);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseAuditRecord(current[0]);
    const sorted = [...record.entries].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const offset = Math.max(0, Math.floor(options.offset));
    const limit = Math.max(1, Math.floor(options.limit));

    return {
        entries: sorted.slice(offset, offset + limit),
        total: sorted.length,
    };
};

const parseRateLimitRecord = (raw: unknown, now: number): RateLimitRecord => {
    if (!raw || typeof raw !== 'object') {
        return {
            windowStartMs: now,
            count: 0,
            updatedAt: new Date(now).toISOString(),
        };
    }

    const candidate = raw as Partial<RateLimitRecord>;
    const windowStartMs = Number(candidate.windowStartMs);
    const count = Number(candidate.count);

    return {
        windowStartMs: Number.isFinite(windowStartMs) ? windowStartMs : now,
        count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0,
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(now).toISOString(),
    };
};

const parseAuditRecord = (raw: unknown): AuditRecord => {
    if (!raw || typeof raw !== 'object') {
        return { updatedAt: new Date(0).toISOString(), entries: [] };
    }

    const candidate = raw as Partial<AuditRecord>;
    const entries = Array.isArray(candidate.entries) ? (candidate.entries.filter(Boolean) as Array<AuditEntry>) : [];
    return {
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
        entries,
    };
};
