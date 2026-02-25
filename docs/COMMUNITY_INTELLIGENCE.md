# Community Intelligence

Community and upstream signal register for the Logs Viewer project.

Last updated: 2026-02-25

## 1. Why this exists

Rocket.Chat evolves quickly (server, Apps-Engine, docs, deployment patterns).  
This document tracks high-signal public sources so product and implementation choices stay aligned with upstream reality and community pain points.

## 2. Verified upstream direction

### 2.1 Built-in workspace logs removed in 8.0

- Rocket.Chat docs explicitly state the workspace Logs Viewer was removed in `8.0`.
- Official recommendation is infrastructure-level observability (for example Loki + Grafana).

Primary sources:

- https://docs.rocket.chat/docs/access-workspace-logs
- https://docs.rocket.chat/docs/configure-workspace-logs
- https://docs.rocket.chat/docs/rocketchat-release-notes
- https://docs.rocket.chat/docs/deprecated-and-phasing-out-features

### 2.2 App API and app-logs endpoints remain available

- Apps can expose custom endpoints via `configuration.api.provideApi(...)`.
- Rocket.Chat exposes app-log APIs for app lifecycle diagnostics:
  - `GET /api/apps/logs`
  - `GET /app/{id}/logs`

Primary sources:

- https://developer.rocket.chat/docs/register-api-endpoints
- https://developer.rocket.chat/apidocs/get-all-apps-logs
- https://developer.rocket.chat/apidocs/get-an-apps-logs
- https://docs.rocket.chat/docs/rocketchat-private-apps

## 3. Community channels to monitor

### 3.1 Forum categories (high signal for operators/app builders)

- Main forum: https://forums.rocket.chat/
- Categories to watch:
  - `Rocket.Chat Apps`
  - `Community Support`
  - `Upgrade Help`
  - `Announcements`

### 3.2 Community server

- Community server: https://open.rocket.chat
- Use for real-time clarifications and peer implementation patterns.

## 4. Known community pain patterns

### 4.1 App logs collection growth

- Long-running community thread reports large `rocketchat_apps_logs` growth in some deployments.
- Implication for this app: keep audit retention bounded; avoid unbounded storage patterns; document cleanup/retention strategy clearly.

Reference:

- https://forums.rocket.chat/t/rocketchat-apps-logs-collection-is-massive/8608

## 5. Candidate issues watchlist (while building)

These are issues we should proactively track because they are likely to affect Rocket.Chat operators broadly, based on community reports, upstream behavior, and implementation experience in this project.

| Candidate issue | Priority | Owner | Typical symptom | Potential impact | Evidence level | App mitigation / design response |
|-----------------|----------|-------|-----------------|------------------|----------------|----------------------------------|
| Public/private app endpoint mismatch | P1 | app | `404` on `/config` or other app routes depending on workspace routing | Viewer appears broken despite app being installed | Field-observed | Resolve app base path defensively; support explicit base-path override in dev |
| Loki ingress missing query routes | P1 | infra | Ingestion works but query fails (`404/502`) | No logs visible in viewer | Community-common deployment pitfall | Runbook validation for `/loki/api/v1/query_range` exposure before rollout |
| Strict RBAC permission transport gaps | P1 | app + ops | `403` in strict mode due missing auth header/origin resolution | Authorized users unexpectedly denied | Field-observed | Explicit `strict|fallback|off` modes and deployment prerequisites in RBAC docs |
| App/API log storage growth | P2 | app + ops | Database collections for logs/audit grow continuously | DB bloat, slower queries, operational cost | Community-reported + field-observed | Enforce bounded retention (`audit_retention_days`) and max entries (`audit_max_entries`) |
| Invalid selector/query guardrails | P2 | app | `400` on query due selector/limit/window validation | User confusion, support load | Field-observed | Tight validation + clear user-facing error messaging in UI and runbook |
| Results readability for large structured logs | P2 | app | Query succeeds but operators struggle to inspect/triage long JSON lines | Slower incident response and lower adoption | Field-observed | Prioritize results UX hardening (expand/collapse detail, pretty/raw toggle, copy affordances) in Phase 2 continuation |
| CORS in local web development | P3 | app + ops | Browser blocks requests from `localhost` | Dev/test blocked, false-negative bug reports | Field-observed | Token-mode proxy path + documented local auth modes |

How to use this watchlist:

1. Add a new row when a pattern appears in community channels or real deployments.
2. Mark evidence level:
   - `Community-reported`: seen in forums/community channels
   - `Field-observed`: reproduced in our environments
   - `Verified`: reproduced and root-caused with code-level fix
3. Assign `priority`:
   - `P1`: blocks production usage or causes high operational risk
   - `P2`: significant reliability/support burden
   - `P3`: development/ergonomics issue with lower production risk
4. Assign `owner`:
   - `app`: code/design changes in this repository
   - `infra`: ingress/Loki/network/deployment changes
   - `ops`: RBAC settings, rollout controls, runbook discipline
5. Link mitigation work in `docs/DRIFT_REGISTER.md` and relevant runbook sections.

## 6. Design implications for this project

1. Keep Loki-backed diagnostics as v1 primary mode for self-hosted operations.
2. Keep strict server-side guardrails (rate limits, bounded windows, redaction, RBAC checks).
3. Treat Rocket.Chat app-log APIs as a potential no-Loki fallback mode:
   - narrow scope to app lifecycle diagnostics (not full workspace server logs)
   - ship only if authorization and retention model are explicit.
4. Keep docs synchronized with upstream behavior changes on each release cycle.

## 7. External references tracked by this project

These links were raised during project discovery and should be revisited during upgrades:

- https://github.com/RocketChat/rocketchat-compose/pull/18
- https://github.com/RocketChat/helm-charts/pull/223

## 8. Operating cadence

- Weekly:
  - scan forum `Announcements` and `Rocket.Chat Apps`
  - scan relevant docs for release/breaking-change updates
- Per release candidate:
  - re-check API docs (`register-api-endpoints`, app logs endpoints)
  - re-check observability guidance docs
- If upstream behavior changes:
  - update `docs/IMPLEMENTATION.md`
  - update `docs/DRIFT_REGISTER.md`
  - update this document and note exact date
