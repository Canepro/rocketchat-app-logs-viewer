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

## Quickstart

### Prerequisites

- Bun installed
- Rocket.Chat workspace with private app upload enabled
- Loki endpoint (for `logs_source_mode=loki`)

### Local build and checks

```bash
bun install
bun run test
bun run typecheck
bun run build
bun run package
```

### Deploy package to workspace

```bash
bun run deploy
```

## Core settings (operator)

Required baseline:
- `logs_source_mode`
- `required_label_selector`
- `allowed_roles`
- `workspace_permission_mode`
- `workspace_permission_code`

Loki mode additionally requires:
- `loki_base_url`
- optional auth (`loki_username`, `loki_token`)

## Security posture

- private slash-response flow by default
- role + workspace-permission gate support
- server-side query validation and limits
- audit records for queries/actions/denials
- response redaction for likely secrets
- bounded sampling for in-chat message safety

## Documentation map

Start with:
- [`docs/README.md`](docs/README.md)
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md)
- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- [`CHANGELOG.md`](CHANGELOG.md)

## Evidence and sensitive artifacts

Raw runtime artifacts (HAR, workspace screenshots, raw app logs) are intentionally not committed. Keep them in private storage and only publish redacted summaries.

Repository policy is documented in [`evidence/README.md`](evidence/README.md).
