# Log Viewer – Rocket.Chat App (Design & Future Implementation)

This repository holds the **design** for a Rocket.Chat Marketplace app that brings log/diagnostics visibility back into the product after logs were removed from the app UI in v8.x. The app **complements** Loki and Grafana; it does not replace them.

- **[DESIGN.md](./DESIGN.md)** – Full design: positioning, **target users and two modes** (Self-hosted Ops vs SaaS Diagnostics), **Rocket.Chat context** (8.0 removal, official Grafana+Loki path, PRs #18/#223), query safety, access model, tenant scoping, guardrails, packaging spike, v1 Loki-only, **slash-command differentiators vs Loki**, and **delivery complexity/effort estimates**.

Summary:

- **Two modes:** (1) **Self-hosted Ops** (v1): Loki-backed log viewer inside RC, with RC-native workflow (deep links, audit, slash command). (2) **SaaS Diagnostics** (v2, optional): only if Rocket.Chat exposes data (app/integration errors, webhooks, audit); explicitly *not* raw server logs.
- **Target users:** Self-hosted ops first; SaaS mode only after validating available data sources. v1 does not promise raw logs for SaaS.
- **Rocket.Chat app:** Slash command `/logs`, External Component, app API proxying to Loki. Permission `view-logs`; audit trail; required Loki labels; strict query builder and operational guardrails.
- **Before implementation:** Packaging spike (§3.5); v1 = Loki-only for self-hosted. For SaaS mode later: validate RC Cloud/SaaS APIs before building.
- **Planning clarity:** Includes command-led product differentiators and realistic effort ranges (MVP vs production v1 vs SaaS Diagnostics).
- **Upstream-aware delivery:** Community and upstream watch process documented to reduce drift from Rocket.Chat product direction.

## North Star

This app is a Rocket.Chat-native diagnostics workflow, not a Loki replacement.

Build toward:
- in-chat incident response workflows (room/thread-aware actions, slash-entry context, audit trail)
- safe and opinionated server-side controls (RBAC, guardrails, redaction)
- fast operator flow inside Rocket.Chat with links to deeper observability when needed

Do not build toward:
- re-implementing Loki/Grafana core capabilities (storage engine, retention engine, full observability suite)
- broad unscoped query power that bypasses Rocket.Chat-centric security and workflow controls

An initial implementation scaffold now exists in this repository and follows the design direction.

## Current scaffold status

This repository now includes a first implementation scaffold:

- **Rocket.Chat app backend (TypeScript):**
  - `main.ts` app entrypoint
  - `src/settings.ts` app settings registration
  - `src/commands/LogsSlashCommand.ts` `/logs` deep-link command with room/thread context
  - `src/api/logs/*` app API scaffold (`/health`, `/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`)
- **External Component UI scaffold (Bun + React + shadcn-ready):**
  - `web/` Vite app with Tailwind and shadcn-style UI primitives
  - wired app API client (`/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`)
  - virtualized log results rendering for large payloads
  - build output configured for `resources/web/`

`POST /query` now supports feature-flagged source modes:
- `loki` (default): proxies to Loki with strict request schema validation and guardrails
- `app_logs` (fallback spike): queries Rocket.Chat app lifecycle logs API (`/api/apps/logs`) using request auth context

Shared security guardrails:
- role-based access (allowed roles setting)
- workspace RBAC permission integration (`workspace_permission_code`, mode `off|fallback|strict`)
- default ships as `workspace_permission_mode=strict` with `workspace_permission_code=view-logs`
- options remain available: `fallback` (rollout compatibility), `off` (local/dev only)
- persistence-backed per-user rate limiting
- persisted query audit trail with retention and max-entry controls
- query bounds enforcement (time window, limit, timeout, selector enforcement)
- response redaction for likely secrets/tokens with configurable replacement text
- row actions endpoint for Rocket.Chat-native workflows (`share`, `incident_draft`, `thread_note`)
- room + thread discovery endpoints for safer action targeting (`/targets`, `/threads`)
- saved views endpoint and UI workflow for persistent query presets (`/views`)
- near-real-time polling workflow in UI with bounded interval controls (`5s` to `300s`) for relative time mode

UI runtime configuration:
- `VITE_ROCKETCHAT_APP_ID` (optional): overrides app ID used in app API path.
- `VITE_ROCKETCHAT_API_ORIGIN` (optional): Rocket.Chat origin for local web development.
- `VITE_ROCKETCHAT_USER_ID` + `VITE_ROCKETCHAT_AUTH_TOKEN` (optional, local dev only): when both are set with `VITE_ROCKETCHAT_API_ORIGIN`, the web client uses same-origin app API calls through Vite proxy (CORS-safe) and forwards these auth headers to Rocket.Chat.
- `VITE_ROCKETCHAT_APP_API_BASE_PATH` (optional): explicit app API base path override (for example `/api/apps/public/<appId>` or a workspace-specific private path).

Local dev auth modes:
- Cookie mode (no dev auth headers): browser calls `VITE_ROCKETCHAT_API_ORIGIN` directly and relies on Rocket.Chat session cookies; requires Rocket.Chat CORS allowance for your localhost origin.
- Token mode (recommended for localhost): set `VITE_ROCKETCHAT_USER_ID` and `VITE_ROCKETCHAT_AUTH_TOKEN`; browser stays same-origin and Vite proxy forwards authenticated calls without CORS dependency.

App API path resolution behavior:
- Default candidate order is public first, then private fallback: `/api/apps/public/<appId>` -> `/api/apps/private/<appId>`.
- On `404`, the client retries the next candidate automatically.
- If `VITE_ROCKETCHAT_APP_API_BASE_PATH` is set, it is tried first, then built-in fallbacks.

`/logs` command usage:
- `/logs`
- `/logs preset=incident`
- `/logs preset=webhook-errors`
- `/logs preset=auth-failures`
- `/logs since=30m level=error limit=200`
- `/logs search=timeout`
- `/logs start=2026-02-24T10:00:00Z end=2026-02-24T11:00:00Z level=warn`
- `/logs preset=incident level=warn search=gateway` (explicit args override preset defaults)

Slash response visibility behavior:
- `/logs` response is private to the invoking user.
- The app opens a private contextual-bar workflow when trigger context is available.
- Fallback path uses user-only notification if contextual-bar open is unavailable.
- The command does not post a room-visible message in channel/group/team contexts.
- The private response includes a quick triage summary (source mode, window, sampled line count, top levels, top signals, and bounded timestamped sample output lines).
- Sidebar preview shows up to 20 sampled lines (truncated for readability); `Copy sample` and `Share sample` can carry up to 50 sampled lines.
- In `app_logs` source mode, quick sample output is intentionally unavailable in slash response; use Open Logs Viewer for full query.
- In-chat-first actions are available directly in the private slash card:
  - `Copy sample`: sends a private copy-ready block of sampled lines.
  - `Share sample`: posts sampled lines into the current room/thread with audit logging.

New workspace quickstart (operator + first user):

1. Install app package and enable it.
2. Configure settings:
   - `logs_source_mode=loki` (or `app_logs` for fallback mode)
   - `loki_base_url` (host only)
   - `required_label_selector`
   - `external_component_url`
   - `allowed_roles`, `workspace_permission_mode`, `workspace_permission_code`
3. Open any channel/DM and run `/logs`.
4. Validate private in-chat behavior:
   - you should see a private contextual bar response
   - preview should show up to 20 sampled lines
   - `Copy sample` (private) and `Share sample` (room/thread) should work
5. Use **Open Logs Viewer** for deeper inspection, saved views, and row actions.

The private workflow includes a one-click "Open Logs Viewer" deep link with:
- room/thread/sender context
- query prefill params (`since` or `start/end`, `level`, `limit`, `search`)
- optional `preset` identifier
- `autorun=1` when explicit filters are provided

Current presets:
- `incident`: `since=30m`, `level=error`, `limit=300`
- `webhook-errors`: `since=2h`, `level=error`, `limit=400`, `search=webhook`
- `auth-failures`: `since=1h`, `level=warn`, `limit=300`, `search=auth failed`

## How to run

1. Install dependencies:
   - `bun install`
2. Build backend + web:
   - `bun run build`
3. Run tests:
   - `bun run test`
4. Package app:
   - `bun run package`
5. Deploy app:
   - `bun run deploy`

Packaging/deploy notes:

- `bun run package` and `bun run deploy` use `rc-apps` native compiler mode (`--experimental-native-compiler`).
- `.rcappsconfig` excludes non-app workspace paths (`web/**`, `tests/**`, docs) from the packaged artifact.

For implementation details and next steps, see:

- **[docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md)** — code map, endpoint behavior, and implementation sequence.
- **[docs/API_CONTRACT.md](./docs/API_CONTRACT.md)** — app API request/response contract and auth model.
- **[docs/USER_GUIDE.md](./docs/USER_GUIDE.md)** — operator/end-user usage, command reference, and troubleshooting.
- **[docs/OPERATOR_PROFILES.md](./docs/OPERATOR_PROFILES.md)** — copy-paste setting bundles for production, rollout, and local-dev.
- **[docs/RUNBOOK.md](./docs/RUNBOOK.md)** — installation, validation, rollback, troubleshooting, and escalation procedures.
- **[docs/MARKETPLACE_CHECKLIST.md](./docs/MARKETPLACE_CHECKLIST.md)** — release and submission readiness checklist.
- **[docs/RELEASE_WORKFLOW.md](./docs/RELEASE_WORKFLOW.md)** — versioning, changelog, package validation, and release evidence workflow.
- **[docs/VERSION_TRACKER.md](./docs/VERSION_TRACKER.md)** — release version baseline, feature-to-version mapping, and next-version recommendation.
- **[docs/GITHUB_PUSH_PLAN.md](./docs/GITHUB_PUSH_PLAN.md)** — branch/commit/PR/tag checklist for clean repository publishing.
- **[CHANGELOG.md](./CHANGELOG.md)** — release history and unreleased change tracking.
- **[docs/RBAC_REVIEW.md](./docs/RBAC_REVIEW.md)** — permission-mode hardening review and failure-mode matrix.
- **[docs/EXECUTION_PLAN.md](./docs/EXECUTION_PLAN.md)** — enterprise delivery phases, quality gates, and definition-of-done.
- **[docs/DRIFT_REGISTER.md](./docs/DRIFT_REGISTER.md)** — tracked design/implementation drift and resolution status.
- **[docs/HANDOFF.md](./docs/HANDOFF.md)** — concise current status and next-step handoff for continuation.
- **[docs/COMMUNITY_INTELLIGENCE.md](./docs/COMMUNITY_INTELLIGENCE.md)** — tracked official/community signals, references, and review cadence.
