# Rocket.Chat Logs Viewer App

Rocket.Chat-native diagnostics app that brings high-signal log triage into chat workflows without trying to replace Loki/Grafana.

## Why this exists

Rocket.Chat moved log visibility away from the app UI in v8.x and now points operators to external observability stacks. This app keeps that architecture, but restores a fast in-chat workflow:

- run `/logs` where the incident happens
- get private, room/thread-aware triage context
- share only what is needed to the right room/thread
- open a richer web view when deeper inspection is needed

## Product scope

This project is intentionally scoped as a Rocket.Chat workflow layer.

In scope:
- Rocket.Chat slash-first operator flow (`/logs`)
- server-side guarded query proxy to Loki (or optional app logs mode)
- RBAC-aware access checks and request audit trail
- chat-native actions: share sample, incident draft, thread note
- focused web UI for query, filtering, saved views, and row actions

Out of scope:
- replacing Loki/Grafana as a full observability platform
- bypassing workspace auth/permissions with direct client-side Loki calls

## Current capabilities

- Rocket.Chat app backend (`main.ts`, `src/**`) with private app API endpoints:
  - `/health`, `/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`
- `/logs` slash command with room/thread context propagation
- external component web app (`web/`) built with Bun + React + Vite + Tailwind
- virtualization for large result sets
- message readability controls (pretty/raw, wrap, collapse/expand, row copy)
- snapshot-backed slash-card actions for reliable copy/share flows
- strict validation, rate limiting, query bounds, selector enforcement, redaction

## Architecture summary

1. User triggers `/logs` in Rocket.Chat.
2. App returns a private contextual bar response with triage summary and actions.
3. Web UI (optional deeper view) calls the app API only.
4. App API enforces auth/RBAC/guardrails and queries Loki server-side.
5. Actions are logged to audit storage for traceability.

## Tech stack

- Runtime: Node.js (Rocket.Chat Apps-Engine)
- Package manager/tooling: Bun
- App backend: TypeScript
- Web UI: React + Vite + Tailwind + shadcn-style primitives
- Tests: Bun test + TypeScript typecheck

## Quickstart (first deployment)

### Prerequisites

- Bun installed (`bun --version`)
- Rocket.Chat workspace where you can install private apps
- For Loki mode: Loki query endpoint reachable from Rocket.Chat runtime
- A hosted web URL for the external component (do not use `http://localhost:5173` for shared environments)
- Recommended default: serve web UI at `https://<rocketchat-host>/logs-viewer/` (same-origin)

### Local build and checks

```bash
bun install
bun run test
bun run typecheck
bun run build
bun run package
```

This produces a deployable artifact in `dist/` (`logs-viewer_<version>.zip`).

### Deploy package to Rocket.Chat workspace

Option A (CLI):

```bash
bun run deploy
```

Option B (Admin UI upload):

1. Open Rocket.Chat Administration.
2. Go to Apps/Marketplace private app upload page (label can vary by Rocket.Chat version).
3. Upload `dist/logs-viewer_<version>.zip`.
4. Enable the app.

### Sync web assets for same-origin hosting (optional helper)

```bash
bun run deploy:web -- --target /srv/rocketchat/logs-viewer
```

## Core settings (operator)

Minimum required values after install:

- `logs_source_mode`
- `allowed_roles`
- `workspace_permission_mode`
- `workspace_permission_code`
- `external_component_url` (must be reachable by end-user browsers)

Loki mode additionally requires:
- `required_label_selector`
- `loki_base_url`
- optional auth (`loki_username`, `loki_token`)

`app_logs` mode note:
- `required_label_selector` is ignored for query execution in `app_logs` mode.

Starter production-safe examples:

- `logs_source_mode=loki`
- `required_label_selector={job="rocketchat"}`
- `allowed_roles=admin,log-viewer`
- `workspace_permission_mode=strict`
- `workspace_permission_code=view-logs`
- `external_component_url=https://<rocketchat-host>/logs-viewer/`

First-time operator path (recommended): [`docs/DEPLOYMENT_QUICKSTART.md`](docs/DEPLOYMENT_QUICKSTART.md)
Same-origin setup reference: [`docs/SAME_ORIGIN_SETUP.md`](docs/SAME_ORIGIN_SETUP.md)

## Security posture

- private slash-response flow by default
- role + workspace-permission gate support
- server-side query validation and limits
- audit records for queries/actions/denials
- response redaction for likely secrets
- bounded sampling for in-chat message safety

## Documentation map

Start with:
- [`docs/DEPLOYMENT_QUICKSTART.md`](docs/DEPLOYMENT_QUICKSTART.md)
- [`docs/SAME_ORIGIN_SETUP.md`](docs/SAME_ORIGIN_SETUP.md)
- [`docs/README.md`](docs/README.md)
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)
- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- [`CHANGELOG.md`](CHANGELOG.md)

## Evidence and sensitive artifacts

Raw runtime artifacts (HAR, workspace screenshots, raw app logs) are intentionally not committed. Keep them in private storage and only publish redacted summaries.

Repository policy is documented in [`evidence/README.md`](evidence/README.md).
