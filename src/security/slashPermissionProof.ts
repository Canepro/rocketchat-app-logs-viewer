import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

import { WorkspacePermissionMode } from './accessControl';

type SlashPermissionSecretRecord = {
    secret: string;
    updatedAt: string;
};

export type SlashPermissionProof = {
    ownerUserId: string;
    permissionMode: WorkspacePermissionMode;
    issuedAt: string;
    expiresAt: string;
    signature: string;
};

const SECRET_ASSOC_KEY = 'slash-permission-proof-secret';
const PROOF_TTL_MS = 5 * 60 * 1000;

export const createSlashPermissionProof = async (
    read: IRead,
    persistence: IPersistence,
    input: { ownerUserId: string; permissionMode: WorkspacePermissionMode; now?: Date },
): Promise<SlashPermissionProof | undefined> => {
    if (!input.ownerUserId) {
        return undefined;
    }

    const secret = await getOrCreateSecret(read, persistence);
    if (!secret) {
        return undefined;
    }

    const issuedAtDate = input.now || new Date();
    const expiresAtDate = new Date(issuedAtDate.getTime() + PROOF_TTL_MS);
    const proof: Omit<SlashPermissionProof, 'signature'> = {
        ownerUserId: input.ownerUserId,
        permissionMode: input.permissionMode,
        issuedAt: issuedAtDate.toISOString(),
        expiresAt: expiresAtDate.toISOString(),
    };

    return {
        ...proof,
        signature: signProof(secret, proof),
    };
};

export const verifySlashPermissionProof = async (
    read: IRead,
    input: {
        actorUserId: string;
        proof: SlashPermissionProof | undefined;
        currentPermissionMode: WorkspacePermissionMode;
        now?: Date;
    },
): Promise<{ allowed: boolean; reason?: 'missing' | 'owner_mismatch' | 'expired' | 'mode_mismatch' | 'invalid_signature' }> => {
    const proof = input.proof;
    if (!proof) {
        return { allowed: false, reason: 'missing' };
    }

    if (proof.ownerUserId !== input.actorUserId) {
        return { allowed: false, reason: 'owner_mismatch' };
    }

    if (proof.permissionMode !== input.currentPermissionMode) {
        return { allowed: false, reason: 'mode_mismatch' };
    }

    const now = input.now || new Date();
    const expiresAt = Date.parse(proof.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) {
        return { allowed: false, reason: 'expired' };
    }

    const secret = await readSecret(read);
    if (!secret) {
        return { allowed: false, reason: 'invalid_signature' };
    }

    const expected = signProof(secret, {
        ownerUserId: proof.ownerUserId,
        permissionMode: proof.permissionMode,
        issuedAt: proof.issuedAt,
        expiresAt: proof.expiresAt,
    });

    const actualBuffer = Buffer.from(proof.signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        return { allowed: false, reason: 'invalid_signature' };
    }

    return { allowed: true };
};

const getOrCreateSecret = async (read: IRead, persistence: IPersistence): Promise<string | undefined> => {
    const existing = await readSecret(read);
    if (existing) {
        return existing;
    }

    if (typeof persistence?.updateByAssociation !== 'function') {
        return undefined;
    }

    const assoc = association();
    const secret = randomBytes(32).toString('hex');
    const record: SlashPermissionSecretRecord = {
        secret,
        updatedAt: new Date().toISOString(),
    };
    await persistence.updateByAssociation(assoc, record, true);
    return secret;
};

const readSecret = async (read: IRead): Promise<string | undefined> => {
    const current = await read.getPersistenceReader().readByAssociation(association());
    const record = parseSecretRecord(current[0]);
    return record?.secret;
};

const parseSecretRecord = (raw: unknown): SlashPermissionSecretRecord | undefined => {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const candidate = raw as Partial<SlashPermissionSecretRecord>;
    if (typeof candidate.secret !== 'string' || !candidate.secret.trim()) {
        return undefined;
    }

    return {
        secret: candidate.secret.trim(),
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
    };
};

const signProof = (
    secret: string,
    input: { ownerUserId: string; permissionMode: WorkspacePermissionMode; issuedAt: string; expiresAt: string },
): string => createHmac('sha256', secret)
    .update(['v1', input.ownerUserId, input.permissionMode, input.issuedAt, input.expiresAt].join('|'))
    .digest('hex');

const association = (): RocketChatAssociationRecord =>
    new RocketChatAssociationRecord(RocketChatAssociationModel.MISC, SECRET_ASSOC_KEY);
