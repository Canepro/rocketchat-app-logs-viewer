import { describe, expect, it } from 'bun:test';
import { HttpStatusCode } from '@rocket.chat/apps-engine/definition/accessors';

import { SETTINGS } from '../src/constants';
import { LogsConfigEndpoint } from '../src/api/logs/LogsConfigEndpoint';

const buildRead = (settingsOverride?: Record<string, unknown>): any => {
    const settings = {
        [SETTINGS.LOGS_SOURCE_MODE]: 'loki',
        [SETTINGS.LOKI_BASE_URL]: 'https://observability.example.com',
        [SETTINGS.REQUIRED_LABEL_SELECTOR]: '{job="rocketchat"}',
        [SETTINGS.ALLOWED_ROLES]: 'admin',
        [SETTINGS.WORKSPACE_PERMISSION_MODE]: 'off',
        [SETTINGS.WORKSPACE_PERMISSION_CODE]: 'view-logs',
        [SETTINGS.DEFAULT_TIME_RANGE]: '15m',
        [SETTINGS.MAX_TIME_WINDOW_HOURS]: 24,
        [SETTINGS.MAX_LINES_PER_QUERY]: 2000,
        [SETTINGS.QUERY_TIMEOUT_MS]: 30000,
        [SETTINGS.RATE_LIMIT_QPM]: 60,
        [SETTINGS.EXTERNAL_COMPONENT_URL]: 'http://localhost:5173',
        ...(settingsOverride || {}),
    };

    return {
        getEnvironmentReader: () => ({
            getSettings: () => ({
                getValueById: async (id: string) => settings[id],
            }),
        }),
    };
};

const buildRequest = (): any => ({
    user: {
        id: 'u-admin',
        roles: ['admin'],
    },
    headers: {},
});

const endpoint = new LogsConfigEndpoint({
    getID: () => 'test-app-id',
} as any);

describe('LogsConfigEndpoint', () => {
    it('returns sourceMode app_logs as ready without Loki requirements', async () => {
        const response = await endpoint.get(
            buildRequest(),
            {} as any,
            buildRead({
                [SETTINGS.LOGS_SOURCE_MODE]: 'app_logs',
                [SETTINGS.LOKI_BASE_URL]: '',
                [SETTINGS.REQUIRED_LABEL_SELECTOR]: '',
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(response.content).toMatchObject({
            ok: true,
            config: {
                sourceMode: 'app_logs',
                readiness: {
                    ready: true,
                    issues: [],
                },
            },
        });
    });

    it('returns Loki readiness issues for missing base URL and invalid selector', async () => {
        const response = await endpoint.get(
            buildRequest(),
            {} as any,
            buildRead({
                [SETTINGS.LOGS_SOURCE_MODE]: 'loki',
                [SETTINGS.LOKI_BASE_URL]: '',
                [SETTINGS.REQUIRED_LABEL_SELECTOR]: 'job="rocketchat"',
            }),
            {} as any,
            {} as any,
            {} as any,
        );

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(response.content).toMatchObject({
            ok: true,
            config: {
                sourceMode: 'loki',
                readiness: {
                    ready: false,
                },
            },
        });

        const issues = (response.content as any)?.config?.readiness?.issues || [];
        expect(Array.isArray(issues)).toBe(true);
        expect(issues).toContain('Loki base URL is not configured.');
        expect(issues.some((item: string) => item.includes('Required label selector is invalid'))).toBe(true);
    });
});
