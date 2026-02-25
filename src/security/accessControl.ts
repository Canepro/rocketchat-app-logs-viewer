import { IHttp, IHttpResponse, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IApiRequest } from '@rocket.chat/apps-engine/definition/api';

import { hasAnyAllowedRole } from './querySecurity';

export type WorkspacePermissionMode = 'off' | 'fallback' | 'strict';

export type AccessDecision = {
    allowed: boolean;
    mode: 'roles' | 'permission' | 'fallback';
    reason?: 'forbidden_role' | 'forbidden_permission' | 'permission_unavailable' | 'permission_check_failed';
    details?: string;
};

type PermissionRecord = {
    id: string;
    roles: Array<string>;
};

export const parseWorkspacePermissionMode = (rawValue: unknown): WorkspacePermissionMode => {
    if (typeof rawValue !== 'string') {
        return 'strict';
    }

    const normalized = rawValue.trim().toLowerCase();
    if (normalized === 'off' || normalized === 'fallback' || normalized === 'strict') {
        return normalized;
    }

    return 'strict';
};

export const parseWorkspacePermissionCode = (rawValue: unknown): string => {
    if (typeof rawValue !== 'string') {
        return 'view-logs';
    }

    const normalized = rawValue.trim();
    return normalized || 'view-logs';
};

export const authorizeRequestUser = async (args: {
    request: IApiRequest;
    read: IRead;
    http: IHttp;
    allowedRoles: Array<string>;
    workspacePermissionCode: string;
    workspacePermissionMode: WorkspacePermissionMode;
}): Promise<AccessDecision> => {
    const user = args.request.user;
    if (!user || !hasAnyAllowedRole(user.roles, args.allowedRoles)) {
        return {
            allowed: false,
            mode: 'roles',
            reason: 'forbidden_role',
        };
    }

    if (args.workspacePermissionMode === 'off') {
        return {
            allowed: true,
            mode: 'roles',
        };
    }

    const auth = extractAuthHeaders(args.request.headers);
    const workspaceOrigin = await resolveWorkspaceOrigin(args.read, args.request.headers);
    if (!auth || !workspaceOrigin) {
        if (args.workspacePermissionMode === 'strict') {
            return {
                allowed: false,
                mode: 'permission',
                reason: 'permission_unavailable',
                details: 'Missing request auth headers or workspace origin.',
            };
        }

        return {
            allowed: true,
            mode: 'fallback',
            reason: 'permission_unavailable',
            details: 'Permission check unavailable; falling back to role-based authorization.',
        };
    }

    const permissionList = await fetchPermissionList(args.http, workspaceOrigin, auth);
    if ('error' in permissionList) {
        if (args.workspacePermissionMode === 'strict') {
            return {
                allowed: false,
                mode: 'permission',
                reason: 'permission_check_failed',
                details: permissionList.error,
            };
        }

        return {
            allowed: true,
            mode: 'fallback',
            reason: 'permission_check_failed',
            details: `Permission check failed; falling back to role authorization. ${permissionList.error}`,
        };
    }

    const permissionGranted = hasPermissionByRoles(permissionList.permissions, args.workspacePermissionCode, user.roles || []);
    if (!permissionGranted) {
        return {
            allowed: false,
            mode: 'permission',
            reason: 'forbidden_permission',
            details: `User does not have required permission: ${args.workspacePermissionCode}`,
        };
    }

    return {
        allowed: true,
        mode: 'permission',
    };
};

export const extractAuthHeaders = (headers: { [key: string]: string } | undefined): { userId: string; authToken: string } | undefined => {
    if (!headers || typeof headers !== 'object') {
        return undefined;
    }

    const normalized = normalizeHeaderMap(headers);
    const userId = normalized['x-user-id'];
    const authToken = normalized['x-auth-token'];
    if (!userId || !authToken) {
        return undefined;
    }

    return { userId, authToken };
};

export const resolveWorkspaceOrigin = async (read: IRead, headers: { [key: string]: string } | undefined): Promise<string | undefined> => {
    try {
        const siteUrl = await read.getEnvironmentReader().getServerSettings().getValueById('Site_Url');
        if (typeof siteUrl === 'string' && /^https?:\/\//i.test(siteUrl.trim())) {
            return siteUrl.trim().replace(/\/$/, '');
        }
    } catch {
        // Fall through to header-derived origin.
    }

    if (!headers || typeof headers !== 'object') {
        return undefined;
    }

    const normalized = normalizeHeaderMap(headers);
    const host = normalized.host;
    if (!host) {
        return undefined;
    }

    const forwardedProto = normalized['x-forwarded-proto'];
    const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : 'https';
    if (!protocol || !/^https?$/i.test(protocol)) {
        return undefined;
    }

    return `${protocol.toLowerCase()}://${host}`;
};

const fetchPermissionList = async (
    http: IHttp,
    workspaceOrigin: string,
    auth: { userId: string; authToken: string },
): Promise<{ permissions: Array<PermissionRecord> } | { error: string }> => {
    const response = await http.get(`${workspaceOrigin}/api/v1/permissions.listAll`, {
        headers: {
            Accept: 'application/json',
            'X-User-Id': auth.userId,
            'X-Auth-Token': auth.authToken,
        },
        timeout: 10000,
    });

    const parsed = parseApiJson(response);
    if ('error' in parsed) {
        return parsed;
    }

    if (response.statusCode >= 400) {
        return {
            error: `permissions.listAll returned ${response.statusCode}`,
        };
    }

    const permissions = parsePermissionsPayload(parsed.payload);
    if (permissions.length === 0) {
        return {
            error: 'permissions.listAll returned no readable permission records.',
        };
    }

    return {
        permissions,
    };
};

const hasPermissionByRoles = (permissions: Array<PermissionRecord>, permissionCode: string, userRoles: Array<string>): boolean => {
    const target = permissionCode.trim().toLowerCase();
    const record = permissions.find((permission) => permission.id.toLowerCase() === target);
    if (!record) {
        return false;
    }

    const assignedRoles = new Set(record.roles.map((role) => role.toLowerCase()));
    if (assignedRoles.has('*')) {
        return true;
    }

    return userRoles.some((role) => assignedRoles.has(String(role).toLowerCase()));
};

const parseApiJson = (response: IHttpResponse): { payload: unknown } | { error: string } => {
    if (response.data && typeof response.data === 'object') {
        return { payload: response.data };
    }

    if (typeof response.content === 'string' && response.content.trim()) {
        try {
            return { payload: JSON.parse(response.content) };
        } catch (error) {
            return {
                error: `Failed to parse permission response JSON: ${String(error)}`,
            };
        }
    }

    return { error: 'Permission response did not include JSON payload.' };
};

const parsePermissionsPayload = (payload: unknown): Array<PermissionRecord> => {
    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const asObject = payload as { permissions?: unknown; update?: unknown };
    const list = Array.isArray(asObject.permissions)
        ? asObject.permissions
        : Array.isArray(asObject.update)
          ? asObject.update
          : [];

    const records: Array<PermissionRecord> = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') {
            continue;
        }

        const candidate = item as { _id?: unknown; id?: unknown; name?: unknown; roles?: unknown };
        const id = [candidate._id, candidate.id, candidate.name].find((value) => typeof value === 'string');
        if (typeof id !== 'string' || !id.trim()) {
            continue;
        }

        const roles = Array.isArray(candidate.roles)
            ? candidate.roles.map((value) => String(value).trim()).filter(Boolean)
            : [];

        records.push({
            id: id.trim(),
            roles,
        });
    }

    return records;
};

const normalizeHeaderMap = (headers: { [key: string]: string }): { [key: string]: string } => {
    const normalized: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(headers)) {
        normalized[key.toLowerCase()] = value;
    }
    return normalized;
};
