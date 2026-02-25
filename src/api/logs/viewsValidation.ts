import { QueryLevel } from './queryValidation';

export type SavedViewQuery = {
    timeMode: 'relative' | 'absolute';
    since?: string;
    start?: string;
    end?: string;
    limit: number;
    level?: QueryLevel;
    search?: string;
};

export type SavedViewsMutation =
    | {
          action: 'create';
          name: string;
          query: SavedViewQuery;
      }
    | {
          action: 'update';
          id: string;
          name?: string;
          query?: SavedViewQuery;
      }
    | {
          action: 'delete';
          id: string;
      };

export const parseSavedViewsListQuery = (
    query: Record<string, unknown> | undefined,
    options?: { defaultLimit?: number; maxLimit?: number },
): { limit: number } => {
    const defaultLimit = clampNumber(options?.defaultLimit, 50, 1, 200);
    const maxLimit = clampNumber(options?.maxLimit, 100, 1, 500);
    return {
        limit: clampNumber(query?.limit, defaultLimit, 1, maxLimit),
    };
};

export const parseSavedViewsMutation = (payload: unknown): { mutation: SavedViewsMutation } | { error: string; details?: unknown } => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { error: 'Saved view payload must be a JSON object.' };
    }

    const objectPayload = payload as Record<string, unknown>;
    const actionRaw = typeof objectPayload.action === 'string' ? objectPayload.action.trim().toLowerCase() : '';
    if (actionRaw !== 'create' && actionRaw !== 'update' && actionRaw !== 'delete') {
        return {
            error: 'Invalid action. Expected one of: create, update, delete.',
            details: { action: objectPayload.action },
        };
    }

    if (actionRaw === 'create') {
        const unknownKeys = Object.keys(objectPayload).filter((key) => !['action', 'name', 'query'].includes(key));
        if (unknownKeys.length > 0) {
            return {
                error: 'Saved view create payload contains unsupported fields.',
                details: { unknownFields: unknownKeys },
            };
        }

        const name = sanitizeString(objectPayload.name, 80);
        if (!name) {
            return { error: 'name is required for create action.' };
        }

        const query = parseSavedViewQuery(objectPayload.query);
        if ('error' in query) {
            return query;
        }

        return {
            mutation: {
                action: 'create',
                name,
                query: query.query,
            },
        };
    }

    if (actionRaw === 'update') {
        const unknownKeys = Object.keys(objectPayload).filter((key) => !['action', 'id', 'name', 'query'].includes(key));
        if (unknownKeys.length > 0) {
            return {
                error: 'Saved view update payload contains unsupported fields.',
                details: { unknownFields: unknownKeys },
            };
        }

        const id = sanitizeString(objectPayload.id, 128);
        if (!id) {
            return { error: 'id is required for update action.' };
        }

        const name = sanitizeString(objectPayload.name, 80) || undefined;
        const query = objectPayload.query === undefined ? undefined : parseSavedViewQuery(objectPayload.query);
        if (query && 'error' in query) {
            return query;
        }

        if (!name && !query) {
            return { error: 'update action requires name and/or query.' };
        }

        return {
            mutation: {
                action: 'update',
                id,
                name,
                query: query?.query,
            },
        };
    }

    const unknownKeys = Object.keys(objectPayload).filter((key) => !['action', 'id'].includes(key));
    if (unknownKeys.length > 0) {
        return {
            error: 'Saved view delete payload contains unsupported fields.',
            details: { unknownFields: unknownKeys },
        };
    }

    const id = sanitizeString(objectPayload.id, 128);
    if (!id) {
        return { error: 'id is required for delete action.' };
    }

    return {
        mutation: {
            action: 'delete',
            id,
        },
    };
};

const parseSavedViewQuery = (raw: unknown): { query: SavedViewQuery } | { error: string; details?: unknown } => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'query is required and must be an object.' };
    }

    const objectQuery = raw as Record<string, unknown>;
    const unknownKeys = Object.keys(objectQuery).filter((key) => !['timeMode', 'since', 'start', 'end', 'limit', 'level', 'search'].includes(key));
    if (unknownKeys.length > 0) {
        return {
            error: 'query contains unsupported fields.',
            details: { unknownFields: unknownKeys },
        };
    }

    const timeModeRaw = typeof objectQuery.timeMode === 'string' ? objectQuery.timeMode.trim().toLowerCase() : '';
    if (timeModeRaw !== 'relative' && timeModeRaw !== 'absolute') {
        return {
            error: 'query.timeMode must be relative or absolute.',
        };
    }

    const limit = clampNumber(objectQuery.limit, -1, 1, 5000);
    if (limit <= 0) {
        return {
            error: 'query.limit must be a positive integer.',
        };
    }

    const levelRaw = typeof objectQuery.level === 'string' ? objectQuery.level.trim().toLowerCase() : '';
    const level = levelRaw ? parseLevel(levelRaw) : undefined;
    if (levelRaw && !level) {
        return {
            error: 'query.level must be one of: error, warn, info, debug.',
        };
    }

    const search = sanitizeString(objectQuery.search, 200) || undefined;
    const since = sanitizeString(objectQuery.since, 32) || undefined;
    const start = sanitizeDateString(objectQuery.start);
    const end = sanitizeDateString(objectQuery.end);

    if (timeModeRaw === 'relative') {
        if (!since) {
            return {
                error: 'query.since is required when timeMode=relative.',
            };
        }

        return {
            query: {
                timeMode: 'relative',
                since,
                limit,
                level,
                search,
            },
        };
    }

    if (!start || !end) {
        return {
            error: 'query.start and query.end are required when timeMode=absolute.',
        };
    }

    if (new Date(start).getTime() >= new Date(end).getTime()) {
        return {
            error: 'query.start must be before query.end.',
        };
    }

    return {
        query: {
            timeMode: 'absolute',
            start,
            end,
            limit,
            level,
            search,
        },
    };
};

const parseLevel = (value: string): QueryLevel | undefined => {
    if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug') {
        return value;
    }

    return undefined;
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

const sanitizeDateString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }

    return parsed.toISOString();
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.floor(parsed)));
};
