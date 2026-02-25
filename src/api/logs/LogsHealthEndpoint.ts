import { IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ApiEndpoint, IApiEndpointInfo, IApiRequest, IApiResponse } from '@rocket.chat/apps-engine/definition/api';

export class LogsHealthEndpoint extends ApiEndpoint {
    public path = 'health';
    public authRequired = true;

    public async get(
        _request: IApiRequest,
        _endpoint: IApiEndpointInfo,
        _read: IRead,
        _modify: IModify,
        _http: IHttp,
        _persistence: IPersistence,
    ): Promise<IApiResponse> {
        return this.success({
            ok: true,
            service: 'logs-viewer-app',
            timestamp: new Date().toISOString(),
        });
    }
}

