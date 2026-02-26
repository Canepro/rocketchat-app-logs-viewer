import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

import { SlashCardSampleLine } from './slashCardActions';

type SlashCardSampleSnapshot = {
    id: string;
    createdAt: string;
    roomId: string;
    roomName: string;
    threadId?: string;
    sourceMode: 'loki' | 'app_logs';
    windowLabel: string;
    filterSummary: string;
    preset: string;
    sampleOutput: Array<SlashCardSampleLine>;
    sampleTotalCount: number;
};

type SlashCardSampleStoreRecord = {
    updatedAt: string;
    entries: Array<SlashCardSampleSnapshot>;
};

const SNAPSHOT_ASSOC_PREFIX = 'slash-card-samples:user:';
const SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MAX_ENTRIES = 8;

export type CreateSlashCardSampleSnapshotInput = {
    ownerUserId: string;
    roomId: string;
    roomName: string;
    threadId?: string;
    sourceMode: 'loki' | 'app_logs';
    windowLabel: string;
    filterSummary: string;
    preset: string;
    sampleOutput: Array<SlashCardSampleLine>;
    sampleTotalCount: number;
};

export const createSlashCardSampleSnapshot = async (
    read: IRead,
    persistence: IPersistence,
    input: CreateSlashCardSampleSnapshotInput,
): Promise<string | undefined> => {
    if (!input.ownerUserId) {
        return undefined;
    }

    const assoc = associationForUser(input.ownerUserId);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseStoreRecord(current[0]);
    const now = Date.now();

    const retained = record.entries.filter((entry) => {
        const createdMs = Date.parse(entry.createdAt);
        return Number.isFinite(createdMs) && now - createdMs <= SNAPSHOT_RETENTION_MS;
    });

    const snapshot: SlashCardSampleSnapshot = {
        id: generateSnapshotId(now),
        createdAt: new Date(now).toISOString(),
        roomId: input.roomId,
        roomName: input.roomName,
        threadId: input.threadId,
        sourceMode: input.sourceMode,
        windowLabel: input.windowLabel,
        filterSummary: input.filterSummary,
        preset: input.preset,
        sampleOutput: input.sampleOutput,
        sampleTotalCount: Math.max(0, Math.floor(input.sampleTotalCount)),
    };

    retained.push(snapshot);
    if (retained.length > SNAPSHOT_MAX_ENTRIES) {
        retained.splice(0, retained.length - SNAPSHOT_MAX_ENTRIES);
    }

    await persistence.updateByAssociation(
        assoc,
        {
            updatedAt: new Date(now).toISOString(),
            entries: retained,
        },
        true,
    );

    return snapshot.id;
};

export const readSlashCardSampleSnapshot = async (
    read: IRead,
    ownerUserId: string,
    snapshotId: string,
): Promise<SlashCardSampleSnapshot | undefined> => {
    if (!ownerUserId || !snapshotId) {
        return undefined;
    }

    const assoc = associationForUser(ownerUserId);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseStoreRecord(current[0]);
    const snapshot = record.entries.find((entry) => entry.id === snapshotId);
    if (!snapshot) {
        return undefined;
    }

    const createdMs = Date.parse(snapshot.createdAt);
    if (!Number.isFinite(createdMs)) {
        return undefined;
    }

    // Enforce TTL at read time as well; otherwise stale entries remain usable until next write.
    if (Date.now() - createdMs > SNAPSHOT_RETENTION_MS) {
        return undefined;
    }

    return snapshot;
};

const associationForUser = (userId: string): RocketChatAssociationRecord =>
    new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, `${SNAPSHOT_ASSOC_PREFIX}${userId}`);

const parseStoreRecord = (raw: unknown): SlashCardSampleStoreRecord => {
    if (!raw || typeof raw !== 'object') {
        return { updatedAt: new Date(0).toISOString(), entries: [] };
    }

    const candidate = raw as Partial<SlashCardSampleStoreRecord>;
    const entries = Array.isArray(candidate.entries)
        ? (candidate.entries.filter((entry) => isSnapshot(entry)) as Array<SlashCardSampleSnapshot>)
        : [];

    return {
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
        entries,
    };
};

const isSnapshot = (value: unknown): value is SlashCardSampleSnapshot => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<SlashCardSampleSnapshot>;
    return typeof candidate.id === 'string'
        && typeof candidate.createdAt === 'string'
        && typeof candidate.roomId === 'string'
        && typeof candidate.roomName === 'string'
        && (candidate.sourceMode === 'loki' || candidate.sourceMode === 'app_logs')
        && typeof candidate.windowLabel === 'string'
        && typeof candidate.filterSummary === 'string'
        && typeof candidate.preset === 'string'
        && Array.isArray(candidate.sampleOutput)
        && typeof candidate.sampleTotalCount === 'number';
};

const generateSnapshotId = (nowMs: number): string => {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `snap_${nowMs.toString(36)}_${randomPart}`;
};
