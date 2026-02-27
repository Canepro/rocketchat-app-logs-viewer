const FALLBACK_APP_ID = '5e4dbe96-2384-4865-ae52-f44f4db2f4d0';

type ApiErrorPayload = {
  ok?: boolean;
  error?: string;
  details?: unknown;
};

export type QueryLevel = 'error' | 'warn' | 'info' | 'debug';
export type QueryResultLevel = QueryLevel | 'unknown';

export type LogsConfig = {
  lokiBaseUrl?: string;
  sourceMode?: 'loki' | 'app_logs';
  defaultTimeRange?: string;
  maxTimeWindowHours?: number;
  maxLinesPerQuery?: number;
  queryTimeoutMs?: number;
  rateLimitQpm?: number;
  levelParserMode?: string;
  externalComponentUrl?: string;
  readiness?: {
    ready: boolean;
    issues: Array<string>;
  };
};

export type LogsEntry = {
  timestamp: string;
  level: QueryResultLevel;
  message: string;
  labels: Record<string, string>;
};

export type LogsActionType = 'share' | 'incident_draft' | 'thread_note';

export type LogsQueryMeta = {
  query: string;
  start: string;
  end: string;
  requestedLimit: number;
  returned: number;
  truncated: boolean;
  requestedLevel: QueryLevel | null;
  search: string | null;
  redaction?: {
    enabled: boolean;
    redactedLines: number;
    totalRedactions: number;
  };
  guardrails: {
    maxTimeWindowHours: number;
    maxLinesPerQuery: number;
    queryTimeoutMs: number;
  };
};

export type LogsQueryResponse = {
  ok: true;
  source: 'loki' | 'app_logs';
  meta: LogsQueryMeta;
  entries: Array<LogsEntry>;
};

export type AuditOutcome = 'allowed' | 'denied';

export type AuditEntry = {
  action:
    | 'query'
    | 'query_denied'
    | 'share'
    | 'share_denied'
    | 'incident_draft'
    | 'incident_draft_denied'
    | 'thread_note'
    | 'thread_note_denied'
    | 'saved_view_list'
    | 'saved_view_list_denied'
    | 'saved_view_create'
    | 'saved_view_create_denied'
    | 'saved_view_update'
    | 'saved_view_update_denied'
    | 'saved_view_delete'
    | 'saved_view_delete_denied';
  userId: string;
  timestamp: string;
  outcome: AuditOutcome;
  reason?: string;
  scope?: Record<string, unknown>;
};

export type AuditResponse = {
  ok: true;
  meta: {
    total: number;
    offset: number;
    limit: number;
    filters: {
      userId: string | null;
      outcome: string | null;
    };
  };
  entries: Array<AuditEntry>;
};

export type LogsActionResponse = {
  ok: true;
  action: LogsActionType;
  postedMessageId: string;
  target: {
    roomId: string;
    threadId: string | null;
  };
};

export type RoomTarget = {
  id: string;
  name: string;
  displayName: string | null;
  type: string;
};

export type TargetsResponse = {
  ok: true;
  targets: {
    rooms: Array<RoomTarget>;
    meta: {
      total: number;
      returned: number;
      limit: number;
      search: string | null;
    };
  };
};

export type ThreadTarget = {
  id: string;
  preview: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  sampleReplyCount: number;
};

export type ThreadsResponse = {
  ok: true;
  threads: {
    items: Array<ThreadTarget>;
    meta: {
      roomId: string;
      total: number;
      returned: number;
      limit: number;
      search: string | null;
    };
  };
};

export type SavedViewQuery = {
  timeMode: 'relative' | 'absolute';
  since?: string;
  start?: string;
  end?: string;
  limit: number;
  level?: QueryLevel;
  search?: string;
};

export type SavedView = {
  id: string;
  name: string;
  query: SavedViewQuery;
  createdAt: string;
  updatedAt: string;
};

export type SavedViewsResponse = {
  ok: true;
  views: {
    items: Array<SavedView>;
    meta: {
      total: number;
      returned: number;
      limit: number;
    };
  };
};

export type SavedViewsMutationResponse = {
  ok: true;
  action: 'create' | 'update' | 'delete';
  view?: SavedView;
  deletedId?: string;
};

class PrivateApiError extends Error {
  public readonly status: number;

  public readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'PrivateApiError';
    this.status = status;
    this.details = details;
  }
}

const appId = (import.meta.env.VITE_ROCKETCHAT_APP_ID || FALLBACK_APP_ID).trim();
const apiOrigin = (import.meta.env.VITE_ROCKETCHAT_API_ORIGIN || '').trim().replace(/\/$/, '');
const devUserId = (import.meta.env.VITE_ROCKETCHAT_USER_ID || '').trim();
const devAuthToken = (import.meta.env.VITE_ROCKETCHAT_AUTH_TOKEN || '').trim();
const configuredApiBasePath = (import.meta.env.VITE_ROCKETCHAT_APP_API_BASE_PATH || '').trim().replace(/\/$/, '');
const hasConfiguredAuthHeaders = devUserId.length > 0 && devAuthToken.length > 0;
const privateAppApiPath = `/api/apps/private/${appId}`;
const publicAppApiPath = `/api/apps/public/${appId}`;
// Local proxy mode is only used when explicit dev auth headers are provided.
// Without those headers, keep direct-origin calls so existing Rocket.Chat cookies can authenticate requests.
const useLocalDevProxy = import.meta.env.DEV && apiOrigin.length > 0 && hasConfiguredAuthHeaders;
// Prefer private app API first because this UI targets private app endpoints.
// Public path remains as fallback for compatibility across workspace deployments.
const rawBasePathCandidates = configuredApiBasePath
  ? [configuredApiBasePath, privateAppApiPath, publicAppApiPath]
  : [privateAppApiPath, publicAppApiPath];

const resolveApiBaseCandidate = (pathOrUrl: string): string => {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl.replace(/\/+$/, '');
  }

  const normalizedPath = `/${pathOrUrl.replace(/^\/+/, '')}`.replace(/\/+$/, '');
  if (useLocalDevProxy) {
    return normalizedPath;
  }

  return `${apiOrigin}${normalizedPath}`;
};

const apiBaseCandidates = rawBasePathCandidates
  .map(resolveApiBaseCandidate)
  .filter((value, index, array) => array.indexOf(value) === index);
const privateApiBase = apiBaseCandidates[0] || resolveApiBaseCandidate(privateAppApiPath);

const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const readStorageValue = (storage: Storage, key: string): string | undefined => {
  try {
    const rawValue = storage.getItem(key);
    if (!rawValue) {
      return undefined;
    }

    const unwrapped = stripWrappingQuotes(rawValue);
    if (!unwrapped) {
      return undefined;
    }

    if ((unwrapped.startsWith('{') && unwrapped.endsWith('}')) || (unwrapped.startsWith('[') && unwrapped.endsWith(']'))) {
      try {
        const parsed = JSON.parse(unwrapped) as { token?: unknown; authToken?: unknown };
        if (typeof parsed.token === 'string' && parsed.token.trim()) {
          return parsed.token.trim();
        }
        if (typeof parsed.authToken === 'string' && parsed.authToken.trim()) {
          return parsed.authToken.trim();
        }
      } catch {
        // fall through and use raw string
      }
    }

    return unwrapped;
  } catch {
    return undefined;
  }
};

const readBrowserStorageAuth = (): { userId: string; authToken: string } | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const storages: Array<Storage> = [window.localStorage, window.sessionStorage];
  const userKeys = ['Meteor.userId', 'rc_uid', 'userId'];
  const tokenKeys = ['Meteor.loginToken', 'rc_token', 'authToken', 'loginToken'];

  let userId: string | undefined;
  let authToken: string | undefined;

  for (const storage of storages) {
    if (!userId) {
      for (const key of userKeys) {
        const value = readStorageValue(storage, key);
        if (value) {
          userId = value;
          break;
        }
      }
    }
    if (!authToken) {
      for (const key of tokenKeys) {
        const value = readStorageValue(storage, key);
        if (value) {
          authToken = value;
          break;
        }
      }
    }
  }

  if (!userId || !authToken) {
    return undefined;
  }

  return { userId, authToken };
};

const readAuthHeaders = (): { 'X-User-Id': string; 'X-Auth-Token': string } | undefined => {
  if (hasConfiguredAuthHeaders) {
    return {
      'X-User-Id': devUserId,
      'X-Auth-Token': devAuthToken,
    };
  }

  const browserAuth = readBrowserStorageAuth();
  if (!browserAuth) {
    return undefined;
  }

  return {
    'X-User-Id': browserAuth.userId,
    'X-Auth-Token': browserAuth.authToken,
  };
};

const parseJsonSafe = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const requestPrivateApi = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const normalizedPath = path.replace(/^\/+/, '');
  let finalError: PrivateApiError | undefined;

  for (let index = 0; index < apiBaseCandidates.length; index += 1) {
    const candidateBase = apiBaseCandidates[index];
    const isLastCandidate = index === apiBaseCandidates.length - 1;
    const authHeaders = readAuthHeaders();

    const response = await fetch(`${candidateBase}/${normalizedPath}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeaders || {}),
        ...(init?.headers || {}),
      },
      ...init,
    });

    const payload = (await parseJsonSafe(response)) as ApiErrorPayload | undefined;
    if (response.ok && payload?.ok !== false) {
      return payload as T;
    }

    const error = new PrivateApiError(payload?.error || `Request failed (${response.status})`, response.status, payload?.details);
    finalError = error;
    if (
      !isLastCandidate
      && candidateBase.includes(`/api/apps/private/${appId}`)
      && (response.status === 404 || response.status === 401)
    ) {
      continue;
    }

    throw error;
  }

  throw finalError || new PrivateApiError('Request failed (no API base candidate)', 500);
};

export const getRuntimeConnection = () => ({
  appId,
  privateApiBase,
  apiBaseCandidates,
  useLocalDevProxy,
  hasConfiguredAuthHeaders,
  hasBrowserStorageAuth: Boolean(readBrowserStorageAuth()),
  hasRuntimeAuthHeaders: Boolean(readAuthHeaders()),
});

export const getConfig = () => requestPrivateApi<{ ok: true; config: LogsConfig }>('config');

export const queryLogs = (input: {
  since?: string;
  start?: string;
  end?: string;
  limit: number;
  level?: QueryLevel;
  search?: string;
}) => {
  const body: Record<string, unknown> = {
    limit: input.limit,
  };

  if (input.level) {
    body.level = input.level;
  }

  const search = input.search?.trim();
  if (search) {
    body.search = search;
  }

  if (input.start || input.end) {
    body.start = input.start;
    body.end = input.end;
  } else if (input.since) {
    body.since = input.since;
  }

  return requestPrivateApi<LogsQueryResponse>('query', {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

export const getAudit = (input: {
  limit: number;
  offset?: number;
  userId?: string;
  outcome?: AuditOutcome;
}) => {
  const params = new URLSearchParams();
  params.set('limit', String(input.limit));
  if (input.offset !== undefined) {
    params.set('offset', String(input.offset));
  }

  const userId = input.userId?.trim();
  if (userId) {
    params.set('userId', userId);
  }

  if (input.outcome) {
    params.set('outcome', input.outcome);
  }

  return requestPrivateApi<AuditResponse>(`audit?${params.toString()}`);
};

export const getTargets = (input?: { search?: string; limit?: number }) => {
  const params = new URLSearchParams();
  if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(input.limit))));
  }

  const search = input?.search?.trim();
  if (search) {
    params.set('search', search);
  }

  const suffix = params.toString();
  return requestPrivateApi<TargetsResponse>(suffix ? `targets?${suffix}` : 'targets');
};

export const getThreads = (input: { roomId: string; search?: string; limit?: number }) => {
  const params = new URLSearchParams();
  params.set('roomId', input.roomId);

  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(input.limit))));
  }

  const search = input.search?.trim();
  if (search) {
    params.set('search', search);
  }

  return requestPrivateApi<ThreadsResponse>(`threads?${params.toString()}`);
};

export const getSavedViews = (input?: { limit?: number }) => {
  const params = new URLSearchParams();
  if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) {
    params.set('limit', String(Math.max(1, Math.floor(input.limit))));
  }
  const suffix = params.toString();
  return requestPrivateApi<SavedViewsResponse>(suffix ? `views?${suffix}` : 'views');
};

export const mutateSavedView = (input:
  | {
      action: 'create';
      name: string;
      query: SavedViewQuery;
    }
  | {
      action: 'update';
      id: string;
      name?: string;
      query?: SavedViewQuery;
    }
  | {
      action: 'delete';
      id: string;
    }) =>
  requestPrivateApi<SavedViewsMutationResponse>('views', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const postLogAction = (input: {
  action: LogsActionType;
  targetRoomId: string;
  targetThreadId?: string;
  entry: LogsEntry;
  context?: {
    source?: string;
    preset?: string;
    roomId?: string;
    roomName?: string;
    threadId?: string;
    search?: string;
    requestedLevel?: string;
  };
}) =>
  requestPrivateApi<LogsActionResponse>('actions', {
    method: 'POST',
    body: JSON.stringify({
      action: input.action,
      targetRoomId: input.targetRoomId,
      targetThreadId: input.targetThreadId,
      entry: input.entry,
      context: input.context,
    }),
  });

export const isPrivateApiError = (error: unknown): error is PrivateApiError => error instanceof PrivateApiError;
