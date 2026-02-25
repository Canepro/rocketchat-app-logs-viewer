import { describe, expect, it } from 'bun:test';

import { authorizeRequestUser, parseWorkspacePermissionMode } from '../src/security/accessControl';

const buildRead = (siteUrl?: string): any => ({
    getEnvironmentReader: () => ({
        getServerSettings: () => ({
            getValueById: async () => {
                if (!siteUrl) {
                    throw new Error('Site_Url unavailable');
                }
                return siteUrl;
            },
        }),
    }),
});

const buildHttp = (payload: unknown, statusCode = 200): any => ({
    get: async () => ({
        statusCode,
        data: payload,
    }),
});

describe('authorizeRequestUser', () => {
    it('allows by role when permission mode is off', async () => {
        const result = await authorizeRequestUser({
            request: {
                headers: {},
                user: { roles: ['admin'] },
            } as any,
            read: buildRead(),
            http: buildHttp({}),
            allowedRoles: ['admin'],
            workspacePermissionCode: 'view-logs',
            workspacePermissionMode: 'off',
        });

        expect(result.allowed).toBe(true);
        expect(result.mode).toBe('roles');
    });

    it('falls back to role auth when permission check is unavailable in fallback mode', async () => {
        const result = await authorizeRequestUser({
            request: {
                headers: {},
                user: { roles: ['admin'] },
            } as any,
            read: buildRead(),
            http: buildHttp({}),
            allowedRoles: ['admin'],
            workspacePermissionCode: 'view-logs',
            workspacePermissionMode: 'fallback',
        });

        expect(result.allowed).toBe(true);
        expect(result.mode).toBe('fallback');
        expect(result.reason).toBe('permission_unavailable');
    });

    it('denies when permission check is unavailable in strict mode', async () => {
        const result = await authorizeRequestUser({
            request: {
                headers: {},
                user: { roles: ['admin'] },
            } as any,
            read: buildRead(),
            http: buildHttp({}),
            allowedRoles: ['admin'],
            workspacePermissionCode: 'view-logs',
            workspacePermissionMode: 'strict',
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('permission_unavailable');
    });

    it('allows when strict permission check succeeds', async () => {
        const result = await authorizeRequestUser({
            request: {
                headers: {
                    'x-user-id': 'u1',
                    'x-auth-token': 't1',
                },
                user: { roles: ['admin'] },
            } as any,
            read: buildRead('https://chat.example.com'),
            http: buildHttp({
                permissions: [
                    {
                        _id: 'view-logs',
                        roles: ['admin'],
                    },
                ],
            }),
            allowedRoles: ['admin'],
            workspacePermissionCode: 'view-logs',
            workspacePermissionMode: 'strict',
        });

        expect(result.allowed).toBe(true);
        expect(result.mode).toBe('permission');
    });

    it('denies when strict permission check reports missing permission', async () => {
        const result = await authorizeRequestUser({
            request: {
                headers: {
                    'x-user-id': 'u1',
                    'x-auth-token': 't1',
                },
                user: { roles: ['admin'] },
            } as any,
            read: buildRead('https://chat.example.com'),
            http: buildHttp({
                permissions: [
                    {
                        _id: 'view-logs',
                        roles: ['owner'],
                    },
                ],
            }),
            allowedRoles: ['admin'],
            workspacePermissionCode: 'view-logs',
            workspacePermissionMode: 'strict',
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('forbidden_permission');
    });

    it('denies in strict mode when permission lookup fails', async () => {
        const result = await authorizeRequestUser({
            request: {
                headers: {
                    'x-user-id': 'u1',
                    'x-auth-token': 't1',
                },
                user: { roles: ['admin'] },
            } as any,
            read: buildRead('https://chat.example.com'),
            http: buildHttp({ error: 'boom' }, 500),
            allowedRoles: ['admin'],
            workspacePermissionCode: 'view-logs',
            workspacePermissionMode: 'strict',
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('permission_check_failed');
    });

    it('falls back to roles in fallback mode when permission lookup fails', async () => {
        const result = await authorizeRequestUser({
            request: {
                headers: {
                    'x-user-id': 'u1',
                    'x-auth-token': 't1',
                },
                user: { roles: ['admin'] },
            } as any,
            read: buildRead('https://chat.example.com'),
            http: buildHttp({ error: 'boom' }, 500),
            allowedRoles: ['admin'],
            workspacePermissionCode: 'view-logs',
            workspacePermissionMode: 'fallback',
        });

        expect(result.allowed).toBe(true);
        expect(result.mode).toBe('fallback');
        expect(result.reason).toBe('permission_check_failed');
    });
});

describe('parseWorkspacePermissionMode', () => {
    it('defaults to strict for missing or invalid values', () => {
        expect(parseWorkspacePermissionMode(undefined)).toBe('strict');
        expect(parseWorkspacePermissionMode('invalid')).toBe('strict');
    });

    it('accepts explicit supported modes', () => {
        expect(parseWorkspacePermissionMode('off')).toBe('off');
        expect(parseWorkspacePermissionMode('fallback')).toBe('fallback');
        expect(parseWorkspacePermissionMode('strict')).toBe('strict');
    });
});
