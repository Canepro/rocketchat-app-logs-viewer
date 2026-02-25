import { IApi, ApiSecurity, ApiVisibility } from '@rocket.chat/apps-engine/definition/api';
import { App } from '@rocket.chat/apps-engine/definition/App';

import { LogsAuditEndpoint } from './logs/LogsAuditEndpoint';
import { LogsActionsEndpoint } from './logs/LogsActionsEndpoint';
import { LogsConfigEndpoint } from './logs/LogsConfigEndpoint';
import { LogsHealthEndpoint } from './logs/LogsHealthEndpoint';
import { LogsQueryEndpoint } from './logs/LogsQueryEndpoint';
import { LogsThreadsEndpoint } from './logs/LogsThreadsEndpoint';
import { LogsTargetsEndpoint } from './logs/LogsTargetsEndpoint';
import { LogsViewsEndpoint } from './logs/LogsViewsEndpoint';

export const createAppApi = (app: App): IApi => ({
    visibility: ApiVisibility.PUBLIC,
    security: ApiSecurity.UNSECURE,
    endpoints: [new LogsHealthEndpoint(app), new LogsConfigEndpoint(app), new LogsQueryEndpoint(app), new LogsAuditEndpoint(app), new LogsActionsEndpoint(app), new LogsTargetsEndpoint(app), new LogsThreadsEndpoint(app), new LogsViewsEndpoint(app)],
});

// Backward-compatible alias used in older docs/notes.
export const createPrivateApi = createAppApi;
