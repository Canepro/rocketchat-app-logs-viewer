import { HttpStatusCode, IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';

import { SETTINGS } from '../../constants';
import { authorizeRequestUser, parseWorkspacePermissionCode, parseWorkspacePermissionMode } from '../../security/accessControl';
import { parseAllowedRoles } from '../../security/querySecurity';
import { parseTargetsQuery } from './targetsValidation';

type RoomTarget = {
    id: string;
    name: string;
    displayName: string | null;
    type: string;
};

const MAX_ROOM_SCAN = 2000;

export class LogsTargetsEndpoint extends ApiEndpoint {
    public path = 'targets';
    public authRequired = true;

    public async get(
        request: IApiRequest,
        _endpoint: IApiEndpointInfo,
        read: IRead,
        _modify: IModify,
        http: IHttp,
        _persistence: IPersistence,
    ): Promise<IApiResponse> {
        if (!request.user) {
            return this.json({
                status: HttpStatusCode.UNAUTHORIZED,
                content: { ok: false, error: 'Authentication required.' },
            });
        }

        const settingsReader = read.getEnvironmentReader().getSettings();
        const [allowedRolesRaw, workspacePermissionCodeRaw, workspacePermissionModeRaw] = await Promise.all([
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_CODE),
            settingsReader.getValueById(SETTINGS.WORKSPACE_PERMISSION_MODE),
        ]);

        const decision = await authorizeRequestUser({
            request,
            read,
            http,
            allowedRoles: parseAllowedRoles(allowedRolesRaw),
            workspacePermissionCode: parseWorkspacePermissionCode(workspacePermissionCodeRaw),
            workspacePermissionMode: parseWorkspacePermissionMode(workspacePermissionModeRaw),
        });
        if (!decision.allowed) {
            return this.json({
                status: HttpStatusCode.FORBIDDEN,
                content: {
                    ok: false,
                    error: 'Insufficient authorization for logs targets access.',
                    reason: decision.reason,
                },
            });
        }

        const parsedQuery = parseTargetsQuery((request.query || {}) as Record<string, unknown>, {
            defaultLimit: 80,
            maxLimit: 200,
            maxSearchLength: 80,
        });

        const roomIds = await read.getUserReader().getUserRoomIds(request.user.id);
        const uniqueRoomIds = [...new Set((roomIds || []).filter(Boolean))].slice(0, MAX_ROOM_SCAN);
        const roomResults = await Promise.all(uniqueRoomIds.map((roomId) => read.getRoomReader().getById(roomId)));

        const allTargets = roomResults.filter(Boolean).map((room) => this.mapRoomToTarget(room!));
        const filteredTargets = this.filterTargets(allTargets, parsedQuery.search);
        const sortedTargets = filteredTargets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        const limitedTargets = sortedTargets.slice(0, parsedQuery.limit);

        return this.success({
            ok: true,
            targets: {
                rooms: limitedTargets,
                meta: {
                    total: sortedTargets.length,
                    returned: limitedTargets.length,
                    limit: parsedQuery.limit,
                    search: parsedQuery.search || null,
                },
            },
        });
    }

    private filterTargets(targets: Array<RoomTarget>, search?: string): Array<RoomTarget> {
        if (!search) {
            return targets;
        }

        const needle = search.toLowerCase();
        return targets.filter((target) => {
            const display = target.displayName ? target.displayName.toLowerCase() : '';
            return target.name.toLowerCase().includes(needle) || display.includes(needle) || target.id.toLowerCase().includes(needle);
        });
    }

    private mapRoomToTarget(room: { id: string; slugifiedName: string; displayName?: string; type: string }): RoomTarget {
        return {
            id: room.id,
            name: room.slugifiedName || room.id,
            displayName: room.displayName || null,
            type: room.type,
        };
    }
}
