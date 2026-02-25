# API Contract

App API contract for Logs Viewer.

Base path:

- Browser client default candidate paths:
  - `/api/apps/public/<appId>`
  - `/api/apps/private/<appId>` (compatibility fallback on `404`)
- For local web dev, `VITE_ROCKETCHAT_APP_API_BASE_PATH` can override the base path and is attempted before built-in fallbacks.

Current endpoint paths are:

- `/health`
- `/config`
- `/query`
- `/audit`
- `/targets`
- `/threads`
- `/views`
- `/actions`

Non-endpoint behavior note:

- Near-real-time updates are currently implemented as UI polling on `POST /query` (no dedicated `/stream` endpoint yet).
- `/logs` slash command uses private response surfaces (contextual bar primary, user notification fallback).
- Slash triage sample sizing policy:
  - in-chat sidebar preview up to `20` lines
  - copy/share action payload up to `50` lines

Compatibility note:

- Design docs may refer to `/logs/*` naming; implementation is currently flat under app base (`/query`, `/config`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`).

## 1. Authentication and authorization

- All endpoints require authenticated Rocket.Chat user context.
- Authorization gate:
  - role allowlist (`allowed_roles`), and
  - workspace RBAC permission check mode (`workspace_permission_mode`) with code (`workspace_permission_code`).

Permission mode behavior:

- `off`: roles only
- `fallback`: attempt RBAC permission check; if unavailable, fallback to roles
- `strict`: RBAC permission check required; unavailable/failed check denies request

Deployment recommendation:

- Default: `strict`
- Production: `strict`
- Transitional rollout: `fallback` (temporary)
- Local/dev troubleshooting: `off` or `fallback`

## 2. GET /health

Response `200`:

```json
{
  "ok": true,
  "service": "logs-viewer-app",
  "timestamp": "2026-02-24T00:00:00.000Z"
}
```

## 3. GET /config

Response `200`:

```json
{
  "ok": true,
  "config": {
    "sourceMode": "loki",
    "lokiBaseUrl": "https://loki.example.com",
    "defaultTimeRange": "15m",
    "maxTimeWindowHours": 24,
    "maxLinesPerQuery": 2000,
    "queryTimeoutMs": 30000,
    "rateLimitQpm": 60,
    "levelParserMode": "label_then_fallback",
    "externalComponentUrl": "https://viewer.example.com",
    "workspacePermissionCode": "view-logs",
    "workspacePermissionMode": "strict",
    "accessMode": "permission",
    "readiness": {
      "ready": true,
      "issues": []
    }
  }
}
```

Errors:

- `401`: unauthenticated
- `403`: authorization denied

## 4. POST /query

Request body (JSON object):

```json
{
  "since": "15m",
  "start": "2026-02-24T10:00:00.000Z",
  "end": "2026-02-24T11:00:00.000Z",
  "limit": 500,
  "level": "error",
  "search": "timeout"
}
```

Rules:

- Use either `since` or `start`+`end`.
- `level` in `error|warn|info|debug`.
- Unknown keys rejected.
- Guardrails enforced server-side (window/limit/timeout).

Response `200`:

```json
{
  "ok": true,
  "source": "loki",
  "meta": {
    "query": "{job=\"rocketchat\"} |= \"timeout\"",
    "start": "2026-02-24T10:00:00.000Z",
    "end": "2026-02-24T11:00:00.000Z",
    "requestedLimit": 500,
    "returned": 120,
    "truncated": false,
    "requestedLevel": "error",
    "search": "timeout",
    "redaction": {
      "enabled": true,
      "redactedLines": 2,
      "totalRedactions": 4
    },
    "access": {
      "mode": "permission",
      "workspacePermissionCode": "view-logs",
      "workspacePermissionMode": "strict"
    },
    "guardrails": {
      "maxTimeWindowHours": 24,
      "maxLinesPerQuery": 2000,
      "queryTimeoutMs": 30000
    }
  },
  "entries": [
    {
      "timestamp": "2026-02-24T10:59:00.000Z",
      "level": "error",
      "message": "...",
      "labels": {
        "job": "rocketchat"
      }
    }
  ]
}
```

`source` can be:

- `loki` (default mode)
- `app_logs` (Rocket.Chat app logs fallback mode)

Errors:

- `400`: invalid query payload
- `401`: unauthenticated
- `403`: authorization denied
- `429`: rate limited
- `502`: Loki upstream/query failure

## 5. GET /audit

Query params:

- `limit` (int)
- `offset` (int)
- `userId` (string, optional)
- `outcome` (`allowed|denied`, optional)

Response `200`:

```json
{
  "ok": true,
  "meta": {
    "total": 100,
    "offset": 0,
    "limit": 50,
    "filters": {
      "userId": null,
      "outcome": "denied"
    }
  },
  "entries": [
    {
      "action": "query_denied",
      "userId": "u123",
      "timestamp": "2026-02-24T12:00:00.000Z",
      "outcome": "denied",
      "reason": "forbidden_role",
      "scope": {}
    }
  ]
}
```

`action` can be:

- `query`
- `query_denied`
- `share`
- `share_denied`
- `incident_draft`
- `incident_draft_denied`
- `thread_note`
- `thread_note_denied`
- `saved_view_list`
- `saved_view_list_denied`
- `saved_view_create`
- `saved_view_create_denied`
- `saved_view_update`
- `saved_view_update_denied`
- `saved_view_delete`
- `saved_view_delete_denied`

Errors:

- `401`: unauthenticated
- `403`: authorization denied

## 6. GET /targets

Purpose:

- Returns room targets for the current user to support safer room selection in row-action UX.

Query params:

- `search` (string, optional)
- `limit` (int, optional)

Response `200`:

```json
{
  "ok": true,
  "targets": {
    "rooms": [
      {
        "id": "GENERAL",
        "name": "general",
        "displayName": "General",
        "type": "c"
      }
    ],
    "meta": {
      "total": 42,
      "returned": 42,
      "limit": 100,
      "search": "gen"
    }
  }
}
```

Errors:

- `401`: unauthenticated
- `403`: authorization denied

## 7. GET /threads

Purpose:

- Returns active thread targets for a selected room to support safer `thread_note` targeting.

Query params:

- `roomId` (string, required)
- `search` (string, optional)
- `limit` (int, optional)

Response `200`:

```json
{
  "ok": true,
  "threads": {
    "items": [
      {
        "id": "k2YfG5NfQnM4s8pRt",
        "preview": "Webhook timeout while posting to upstream endpoint",
        "createdAt": "2026-02-24T11:00:00.000Z",
        "lastActivityAt": "2026-02-24T11:05:00.000Z",
        "sampleReplyCount": 4
      }
    ],
    "meta": {
      "roomId": "GENERAL",
      "total": 15,
      "returned": 15,
      "limit": 100,
      "search": "webhook"
    }
  }
}
```

Errors:

- `400`: missing/invalid roomId
- `401`: unauthenticated
- `403`: authorization denied or user has no access to target room

## 8. GET /views

Purpose:

- Returns saved query presets for the current user.

Query params:

- `limit` (int, optional)

Response `200`:

```json
{
  "ok": true,
  "views": {
    "items": [
      {
        "id": "sv_lx29f6pc_7mj9n2e1",
        "name": "Last 30m errors",
        "query": {
          "timeMode": "relative",
          "since": "30m",
          "limit": 300,
          "level": "error",
          "search": "timeout"
        },
        "createdAt": "2026-02-25T11:00:00.000Z",
        "updatedAt": "2026-02-25T11:30:00.000Z"
      }
    ],
    "meta": {
      "total": 4,
      "returned": 4,
      "limit": 50
    }
  }
}
```

Errors:

- `401`: unauthenticated
- `403`: authorization denied

## 9. POST /views

Purpose:

- Creates, updates, or deletes saved query presets for the current user.

Request body (create):

```json
{
  "action": "create",
  "name": "Last 30m errors",
  "query": {
    "timeMode": "relative",
    "since": "30m",
    "limit": 300,
    "level": "error",
    "search": "timeout"
  }
}
```

Request body (update):

```json
{
  "action": "update",
  "id": "sv_lx29f6pc_7mj9n2e1",
  "name": "Last 30m errors (team)",
  "query": {
    "timeMode": "relative",
    "since": "30m",
    "limit": 500
  }
}
```

Request body (delete):

```json
{
  "action": "delete",
  "id": "sv_lx29f6pc_7mj9n2e1"
}
```

Rules:

- `action` is required and must be `create|update|delete`.
- Strict schema validation; unknown fields are rejected.
- Saved views are scoped to the request user.

Response `200` (create/update):

```json
{
  "ok": true,
  "action": "create",
  "view": {
    "id": "sv_lx29f6pc_7mj9n2e1",
    "name": "Last 30m errors",
    "query": {
      "timeMode": "relative",
      "since": "30m",
      "limit": 300
    },
    "createdAt": "2026-02-25T11:00:00.000Z",
    "updatedAt": "2026-02-25T11:00:00.000Z"
  }
}
```

Response `200` (delete):

```json
{
  "ok": true,
  "action": "delete",
  "deletedId": "sv_lx29f6pc_7mj9n2e1"
}
```

Errors:

- `400`: invalid saved-view payload
- `401`: unauthenticated
- `403`: authorization denied
- `404`: target saved view not found

## 10. POST /actions

Purpose:

- Performs Rocket.Chat-native row actions from query results.
- Current supported actions:
  - `share`: post a log entry summary in a room/thread
  - `incident_draft`: post an incident template seeded with log evidence
  - `thread_note`: post a concise note directly into an existing thread

Request body:

```json
{
  "action": "share",
  "targetRoomId": "GENERAL",
  "targetThreadId": "optional-thread-message-id",
  "entry": {
    "timestamp": "2026-02-24T11:00:00.000Z",
    "level": "error",
    "message": "Webhook timeout",
    "labels": {
      "job": "rocketchat",
      "service": "webhook"
    }
  },
  "context": {
    "source": "slash-command",
    "preset": "incident",
    "search": "timeout"
  }
}
```

Rules:

- `targetRoomId` required.
- `targetThreadId` optional, must belong to `targetRoomId` when provided.
- `targetThreadId` is required when `action=thread_note`.
- Caller must have access to `targetRoomId`.
- Payload uses strict schema; unknown fields are rejected.
- Endpoint is RBAC-gated and rate-limited.

Response `200`:

```json
{
  "ok": true,
  "action": "share",
  "postedMessageId": "m123",
  "target": {
    "roomId": "GENERAL",
    "threadId": "optional-thread-message-id"
  }
}
```

Errors:

- `400`: invalid action payload, room, or thread
- `401`: unauthenticated
- `403`: authorization denied or user has no access to target room
- `429`: rate limited
