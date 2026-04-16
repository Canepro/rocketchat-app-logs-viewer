import { describe, expect, it } from 'bun:test';

import { createSlashPermissionProof, verifySlashPermissionProof } from '../src/security/slashPermissionProof';

const createStatefulSecretStore = (): {
    read: any;
    persistence: any;
} => {
    let permissionProofSecretRecord: unknown;

    return {
        read: {
            getPersistenceReader: () => ({
                readByAssociation: async (association: any) => {
                    const id = typeof association?.id === 'string'
                        ? association.id
                        : (typeof association?.getID === 'function' ? association.getID() : '');
                    if (id.includes('slash-permission-proof-secret') && permissionProofSecretRecord) {
                        return [permissionProofSecretRecord];
                    }

                    return [];
                },
            }),
        },
        persistence: {
            updateByAssociation: async (_association: unknown, record: unknown) => {
                permissionProofSecretRecord = record;
            },
        },
    };
};

describe('slashPermissionProof', () => {
    it('creates and verifies a fresh proof for the issuing user', async () => {
        const { read, persistence } = createStatefulSecretStore();
        const now = new Date('2026-02-26T10:00:00.000Z');
        const proof = await createSlashPermissionProof(read, persistence, {
            ownerUserId: 'u1',
            permissionMode: 'strict',
            now,
        });

        expect(proof).toBeDefined();
        const verified = await verifySlashPermissionProof(read, {
            actorUserId: 'u1',
            proof,
            currentPermissionMode: 'strict',
            now: new Date('2026-02-26T10:02:00.000Z'),
        });

        expect(verified).toEqual({ allowed: true });
    });

    it('rejects proofs used by a different actor', async () => {
        const { read, persistence } = createStatefulSecretStore();
        const proof = await createSlashPermissionProof(read, persistence, {
            ownerUserId: 'u1',
            permissionMode: 'strict',
            now: new Date('2026-02-26T10:00:00.000Z'),
        });

        const verified = await verifySlashPermissionProof(read, {
            actorUserId: 'u2',
            proof,
            currentPermissionMode: 'strict',
            now: new Date('2026-02-26T10:01:00.000Z'),
        });

        expect(verified).toEqual({ allowed: false, reason: 'owner_mismatch' });
    });

    it('rejects expired proofs', async () => {
        const { read, persistence } = createStatefulSecretStore();
        const proof = await createSlashPermissionProof(read, persistence, {
            ownerUserId: 'u1',
            permissionMode: 'strict',
            now: new Date('2026-02-26T10:00:00.000Z'),
        });

        const verified = await verifySlashPermissionProof(read, {
            actorUserId: 'u1',
            proof,
            currentPermissionMode: 'strict',
            now: new Date('2026-02-26T10:06:00.000Z'),
        });

        expect(verified).toEqual({ allowed: false, reason: 'expired' });
    });
});
