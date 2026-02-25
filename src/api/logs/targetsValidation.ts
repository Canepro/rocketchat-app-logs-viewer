export type TargetsQuery = {
    search?: string;
    limit: number;
};

export const parseTargetsQuery = (
    query: Record<string, unknown> | undefined,
    options?: {
        defaultLimit?: number;
        maxLimit?: number;
        maxSearchLength?: number;
    },
): TargetsQuery => {
    const defaultLimit = clampNumber(options?.defaultLimit, 50, 1, 200);
    const maxLimit = clampNumber(options?.maxLimit, 200, 1, 500);
    const maxSearchLength = clampNumber(options?.maxSearchLength, 80, 10, 200);

    const limit = clampNumber(query?.limit, defaultLimit, 1, maxLimit);
    const searchRaw = typeof query?.search === 'string' ? query.search.trim() : '';
    const search = searchRaw ? searchRaw.slice(0, maxSearchLength) : undefined;

    return {
        search,
        limit,
    };
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.floor(parsed)));
};
