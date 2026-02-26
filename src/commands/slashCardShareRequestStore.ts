import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

type ShareElsewhereRequestEntry = {
    id: string;
    createdAt: string;
    actionPayload: string;
};

type ShareElsewhereRequestRecord = {
    updatedAt: string;
    entries: Array<ShareElsewhereRequestEntry>;
};

const REQUEST_ASSOC_PREFIX = 'slash-card-share-elsewhere:user:';
const REQUEST_RETENTION_MS = 30 * 60 * 1000;
const REQUEST_MAX_ENTRIES = 10;

export const createShareElsewhereRequest = async (
    read: IRead,
    persistence: IPersistence,
    ownerUserId: string,
    actionPayload: string,
): Promise<string | undefined> => {
    if (!ownerUserId || !actionPayload) {
        return undefined;
    }

    const assoc = associationForUser(ownerUserId);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseRecord(current[0]);
    const now = Date.now();
    const retained = filterRecent(record.entries, now);

    const entry: ShareElsewhereRequestEntry = {
        id: generateRequestId(now),
        createdAt: new Date(now).toISOString(),
        actionPayload,
    };

    retained.push(entry);
    if (retained.length > REQUEST_MAX_ENTRIES) {
        retained.splice(0, retained.length - REQUEST_MAX_ENTRIES);
    }

    await persistence.updateByAssociation(
        assoc,
        {
            updatedAt: new Date(now).toISOString(),
            entries: retained,
        },
        true,
    );

    return entry.id;
};

export const readShareElsewhereRequest = async (
    read: IRead,
    ownerUserId: string,
    requestId: string,
): Promise<string | undefined> => {
    if (!ownerUserId || !requestId) {
        return undefined;
    }

    const assoc = associationForUser(ownerUserId);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseRecord(current[0]);
    const now = Date.now();
    const retained = filterRecent(record.entries, now);
    const entry = retained.find((item) => item.id === requestId);
    return entry?.actionPayload;
};

export const deleteShareElsewhereRequest = async (
    read: IRead,
    persistence: IPersistence,
    ownerUserId: string,
    requestId: string,
): Promise<void> => {
    if (!ownerUserId || !requestId) {
        return;
    }

    const assoc = associationForUser(ownerUserId);
    const current = await read.getPersistenceReader().readByAssociation(assoc);
    const record = parseRecord(current[0]);
    const now = Date.now();
    const retained = filterRecent(record.entries, now).filter((entry) => entry.id !== requestId);

    await persistence.updateByAssociation(
        assoc,
        {
            updatedAt: new Date(now).toISOString(),
            entries: retained,
        },
        true,
    );
};

const associationForUser = (userId: string): RocketChatAssociationRecord =>
    new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, `${REQUEST_ASSOC_PREFIX}${userId}`);

const filterRecent = (entries: Array<ShareElsewhereRequestEntry>, now: number): Array<ShareElsewhereRequestEntry> =>
    entries.filter((entry) => {
        const createdMs = Date.parse(entry.createdAt);
        return Number.isFinite(createdMs) && now - createdMs <= REQUEST_RETENTION_MS;
    });

const parseRecord = (raw: unknown): ShareElsewhereRequestRecord => {
    if (!raw || typeof raw !== 'object') {
        return { updatedAt: new Date(0).toISOString(), entries: [] };
    }

    const candidate = raw as Partial<ShareElsewhereRequestRecord>;
    const entries = Array.isArray(candidate.entries)
        ? candidate.entries.filter((entry) => isEntry(entry)) as Array<ShareElsewhereRequestEntry>
        : [];

    return {
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
        entries,
    };
};

const isEntry = (value: unknown): value is ShareElsewhereRequestEntry => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<ShareElsewhereRequestEntry>;
    return typeof candidate.id === 'string'
        && typeof candidate.createdAt === 'string'
        && typeof candidate.actionPayload === 'string';
};

const generateRequestId = (nowMs: number): string => {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `req_${nowMs.toString(36)}_${randomPart}`;
};
