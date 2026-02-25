export type ThreadsQuery = {
    roomId: string;
    search?: string;
    limit: number;
};

export const parseThreadsQuery = (
    query: Record<string, unknown> | undefined,
    options?: {
        defaultLimit?: number;
        maxLimit?: number;
        maxSearchLength?: number;
        maxRoomIdLength?: number;
    },
): { query: ThreadsQuery } | { error: string } => {
    const defaultLimit = clampNumber(options?.defaultLimit, 40, 1, 200);
    const maxLimit = clampNumber(options?.maxLimit, 100, 1, 300);
    const maxSearchLength = clampNumber(options?.maxSearchLength, 80, 10, 200);
    const maxRoomIdLength = clampNumber(options?.maxRoomIdLength, 128, 16, 256);

    const roomIdRaw = typeof query?.roomId === 'string' ? query.roomId : '';
    const roomId = roomIdRaw.trim().slice(0, maxRoomIdLength);
    if (!roomId) {
        return { error: 'roomId query parameter is required.' };
    }

    const limit = clampNumber(query?.limit, defaultLimit, 1, maxLimit);
    const searchRaw = typeof query?.search === 'string' ? query.search.trim() : '';
    const search = searchRaw ? searchRaw.slice(0, maxSearchLength) : undefined;

    return {
        query: {
            roomId,
            search,
            limit,
        },
    };
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.floor(parsed)));
};
