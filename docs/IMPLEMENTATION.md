# Implementation guide

This file documents the current scaffold and implemented backend behavior.

## 0. Version snapshot

- `app.json` version: `0.1.0`
- Baseline release: `0.1.0` (see `CHANGELOG.md`)
- Ongoing post-baseline changes are tracked under `Unreleased` in `CHANGELOG.md` and mapped in `docs/VERSION_TRACKER.md`.

## 1. Code map

### Backend (Rocket.Chat App)

- `app.json`
  - App metadata consumed by `rc-apps`.
  - `classFile` points to `main.ts`.
- `.rcappsconfig`
  - Packaging ignore configuration used by `rc-apps` to exclude workspace-only paths from zip artifacts.
- `main.ts`
  - App entrypoint (`LogsViewerApp`).
  - Registers settings, slash command, app API, and external component.
  - Handles UIKit block actions for private slash-card buttons (`Copy sample`, `Share sample`).
- `src/constants.ts`
  - Central IDs for commands and settings.
- `src/settings.ts`
  - App settings definitions (Loki URL/auth/default range/external UI URL + role/rate/audit/redaction controls).
- `src/security/querySecurity.ts`
  - Shared security primitives for logs endpoints:
    - allowed role parsing
    - per-user rate limiting (persistence-backed)
    - audit append with retention/max-entry trimming
    - audit read helper
- `src/security/accessControl.ts`
  - Authorization orchestration for app endpoints:
    - role allowlist gate
    - workspace RBAC permission check modes (`off`, `fallback`, `strict`)
    - permission-role evaluation via workspace `permissions.listAll`
- `src/security/redaction.ts`
  - Message redaction helpers for likely secrets/tokens/PII patterns before response serialization.
- `src/commands/LogsSlashCommand.ts`
  - `/logs` command with role checks and argument parsing (`preset/since/start/end/level/limit/search`).
  - Declares `view-logs` workspace permission requirement for slash command visibility/execution.
  - Intentionally prioritizes quick, context-aware entry and does not block on Loki connection settings.
  - Builds a contextual deep link to External Component UI (room/thread/sender context + prefilled query params).
  - Supports built-in presets (`incident`, `webhook-errors`, `auth-failures`) where explicit args override preset defaults.
  - Slash response is private to the invoking user:
    - primary path opens private contextual-bar surface with one-click "Open Logs Viewer"
    - fallback path sends user-only notification with deep link and visibility notice.
  - Private slash response includes quick triage summary metadata plus timestamped sample output lines (bounded and truncated).
  - Current sample behavior:
    - sidebar preview up to 20 lines
    - action payload for copy/share up to 50 lines
  - Includes numeric severity fallback mapping for common JSON numeric levels.
  - Private slash card includes in-chat action buttons:
    - `Copy sample` -> private copy-ready evidence block
    - `Share sample` -> posts sampled evidence in-room/in-thread with audit entry
- `src/commands/slashCardActions.ts`
  - Encodes/decodes slash-card button payloads with strict sanitization and bounds.
  - Centralizes action IDs and sample line payload limits.
- `src/commands/slashCardActionHandler.ts`
  - Handles UIKit block-action callbacks for slash-card buttons.
  - Re-validates role authorization at click time.
  - Resolves user/room context server-side for safer cross-client behavior.
  - Emits private copy response and audited in-room share action.
- `src/api/index.ts`
  - API registry builder for app API.
- `src/api/logs/queryValidation.ts`
  - Shared request schema validation and query normalization (`start/end/since/limit/level/search`).
- `src/api/logs/actionValidation.ts`
  - Strict payload validation and message composition for row actions (`share`, `incident_draft`, `thread_note`).
- `src/api/logs/LogsHealthEndpoint.ts`
  - `GET /health` liveness check.
- `src/api/logs/LogsConfigEndpoint.ts`
  - `GET /config` returns non-secret viewer defaults for authenticated users.
- `src/api/logs/LogsQueryEndpoint.ts`
  - `POST /query` Loki proxy with strict request validation, selector enforcement, role/rate checks, response redaction, and audit logging.
- `src/api/logs/LogsAuditEndpoint.ts`
  - `GET /audit` role-gated query audit inspection endpoint.
- `src/api/logs/LogsTargetsEndpoint.ts`
  - `GET /targets` user-scoped room target discovery for safer room selection UX.
- `src/api/logs/threadsValidation.ts`
  - `GET /threads` query parser (`roomId/search/limit`) for room-scoped thread discovery.
- `src/api/logs/LogsThreadsEndpoint.ts`
  - `GET /threads` user-scoped thread target discovery within a selected room.
- `src/api/logs/viewsValidation.ts`
  - `GET/POST /views` validation for list limits and strict saved-view mutation payloads.
- `src/api/logs/LogsViewsEndpoint.ts`
  - `GET /views` and `POST /views` for user-scoped saved query presets (create/update/delete) with audit logging.
- `src/api/logs/LogsActionsEndpoint.ts`
  - `POST /actions` Rocket.Chat-native row actions:
    - validates action payload, room/thread targets, and user room access
    - posts app-authored message into target room/thread
    - writes allowed/denied action audit events

### Frontend (External Component UI)

- `web/`
  - Bun-managed React app scaffolded with Vite.
  - Tailwind + shadcn-ready primitives.
- `web/src/App.tsx`
  - Query + audit interface wired to app API.
  - Includes query forms, error handling states, and virtualized results rendering.
  - Consumes deep-link query params (`preset`, room/thread context, filters) for prefill and optional autorun flow.
  - Includes row actions on each result (`Share to room`, `Create incident draft`, `Add thread note`) targeting configured room/thread IDs.
  - Includes row-action UX hardening: slash-context target quick-fill controls, readiness badges, action-specific disable states, and audit auto-refresh on successful action posting.
  - Includes room-scoped thread discovery UX (`/threads`) with searchable thread quick-selection.
  - Includes saved views workflow (`/views`) with create/apply/update/delete controls.
  - Includes near-real-time polling controls with safe interval clamp and start/stop behavior.
- `web/src/lib/api.ts`
  - Typed app API client for `/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, and `/actions`.
  - Centralizes credentials, error normalization, and runtime API path resolution.
- `web/src/components/ui/*`
  - Basic shadcn-style UI primitives (`button`, `badge`, `card`).
- `web/vite.config.ts`
  - Build output targets `../resources/web`.
- `tests/*`
  - Bun test suite covering query/target/thread validation, action validation, redaction, access control behavior, and slash command parsing.
  - Includes endpoint-level behavior tests for `GET /threads` (`tests/logsThreadsEndpoint.test.ts`) covering auth, membership, and success-path shaping.
  - Includes endpoint-level negative-path coverage for:
    - `POST /actions` (`tests/logsActionsEndpoint.test.ts`)
    - `POST /query` (`tests/logsQueryEndpoint.test.ts`)
    - `GET /audit` (`tests/logsAuditEndpoint.test.ts`)
  - Includes integration-style denied-path audit-write coupling assertions for:
    - `POST /query` (`tests/logsQueryEndpoint.test.ts`)
    - `POST /actions` (`tests/logsActionsEndpoint.test.ts`)
    - `GET/POST /views` (`tests/logsViewsEndpoint.test.ts`)
  - Includes saved-view coverage:
    - validation (`tests/viewsValidation.test.ts`)
    - endpoint behavior (`tests/logsViewsEndpoint.test.ts`)
  - Includes polling helper validation coverage:
    - interval parsing/clamping and invalid-input handling (`tests/pollingValidation.test.ts`)
  - Includes explicit permission-mode coverage (`strict|fallback|off`) in access-control and endpoint tests.
  - Includes slash-card action payload/helper tests (`tests/slashCardActions.test.ts`).
  - Includes slash-card action handler tests for copy/share/deny paths (`tests/slashCardActionHandler.test.ts`).

## 2. API behavior (current)

- Browser base-path resolution:
  - primary: `/api/apps/public/<appId>`
  - fallback on `404`: `/api/apps/private/<appId>`
  - optional explicit override: `VITE_ROCKETCHAT_APP_API_BASE_PATH`
- `GET /api/apps/.../health`
  - Auth required.
  - Returns `ok`, service name, and timestamp.
- `GET /api/apps/.../config`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Returns non-secret viewer defaults (`defaultTimeRange`, query guardrails, rate limit, external component URL).
- `POST /api/apps/.../query`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Per-user rate limited.
  - Feature-flagged source mode:
    - `loki` (default): validates Loki readiness (`loki_base_url`, selector) at query time.
    - `app_logs`: queries Rocket.Chat app lifecycle logs API (`/api/apps/logs`) using request auth context.
  - Validates/normalizes query payload via shared parser.
  - Loki mode proxies to `query_range` with strict server-side query construction (`required_label_selector` + optional search pipeline).
  - Enforces time window, result limit, and timeout guardrails.
  - Redacts likely sensitive values in returned log lines when enabled.
  - Writes allowed/denied query audit entries to app persistence.
- `GET /api/apps/.../audit`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Returns persisted audit entries with pagination and optional `userId`/`outcome` filters.
- `GET /api/apps/.../targets`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Returns user-scoped room target list with optional search and limit controls.
- `GET /api/apps/.../threads`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Requires `roomId`; validates room existence and caller room access.
  - Returns recent active thread targets for the selected room with optional search and limit controls.
- `GET /api/apps/.../views`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Returns user-scoped saved query presets.
- `POST /api/apps/.../views`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Creates, updates, and deletes saved query presets with strict payload validation.
- `POST /api/apps/.../actions`
  - Auth required.
  - Role-gated + optional workspace RBAC permission check (`off|fallback|strict` mode).
  - Per-user action rate limited.
  - Validates action schema (`share|incident_draft|thread_note`) and target room/thread.
  - Enforces user membership in target room.
  - Posts app-authored message in target room/thread and audits result.

## 3. Recommended implementation sequence

1. Contract + security hardening
  - Add `view-logs` permission enforcement (with role allowlist as optional second gate).
  - Add backend and slash-command tests for validation/security/preset precedence.
2. External Component
   - Keep shipped row-action workflows and polling UX stable.
   - Evaluate stream-style diagnostics only after an explicit backend `/stream` contract and security review.
3. Multi-tenant policy hardening
   - Add allowlist-based label policy for tenant/environment scoping.
   - Add policy tests for selector composition and cross-tenant leakage prevention.
4. Product workflow
   - Add deep links from slash command and action buttons into filtered views.
   - Add in-app diagnostics shortcuts (e.g., “last error in this room context”).
5. Packaging/deployment
   - Validate app-served static asset strategy from design spike (Option A vs B).

## 4. Current slash presets

- `incident`: `since=30m`, `level=error`, `limit=300`
- `webhook-errors`: `since=2h`, `level=error`, `limit=400`, `search=webhook`
- `auth-failures`: `since=1h`, `level=warn`, `limit=300`, `search=auth failed`

Preset precedence:
- If both a preset and explicit args are provided, explicit args win.

## 5. Dev commands

- Install deps: `bun install`
- Build all: `bun run build`
- Typecheck all: `bun run typecheck`
- Build app only: `bun run build:app`
- Build web only: `bun run build:web`
- Package app: `bun run package` (`rc-apps --experimental-native-compiler`)
- Deploy app: `bun run deploy` (`rc-apps --experimental-native-compiler`)

## 6. Notes

- Backend query path now performs real Loki proxying with defensive controls.
- Product policy: keep `/logs` fast and context-first; surface Loki configuration errors at viewer/query time instead of blocking command open.
- Default/production posture: `workspace_permission_mode=strict`; reserve `fallback` for onboarding or temporary compatibility, and `off` for local development only.
- UI now has working API wiring for query/audit/target/thread/saved-view/action flows and near-real-time polling controls; server-push stream mode remains pending.
- Packaging pipeline is hardened for monorepo layout:
  - native compiler mode for package/deploy
  - `.rcappsconfig` ignore list for `web/**`, `tests/**`, and docs paths
- Plan and drift governance live in `docs/EXECUTION_PLAN.md` and `docs/DRIFT_REGISTER.md`.
- End-user/operator guide lives in `docs/USER_GUIDE.md`.
- API schema and compatibility notes live in `docs/API_CONTRACT.md`.
- Deployment profile bundles live in `docs/OPERATOR_PROFILES.md`.
- Operator operations procedure lives in `docs/RUNBOOK.md`.
- Marketplace submission readiness gates live in `docs/MARKETPLACE_CHECKLIST.md`.
- Release governance process lives in `docs/RELEASE_WORKFLOW.md` and `CHANGELOG.md`.
- Permission hardening review lives in `docs/RBAC_REVIEW.md`.
