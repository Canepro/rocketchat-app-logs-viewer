# Log Viewer – Rocket.Chat Marketplace App (Design)

A first-class Rocket.Chat app that brings log visibility back into the product, **without replacing Loki**. It acts as the “log UI inside Rocket.Chat,” using Loki as the robust backend for v1 (with optional adapters later). Whatever is worth doing should be done well; this document defines scope, architecture, and implementation choices.

---

## 1. Positioning

| Goal | Not goal |
|------|----------|
| Logs visible inside Rocket.Chat for admins | Replace Loki, Grafana, or existing observability |
| One-click experience after install | Reimplement storage, retention, or query engine |
| Works with existing Loki first (v1) | Require users to adopt new infra they don’t have |
| Marketplace app: install, configure, use | Monolith that does everything |

**Value proposition:** “Install the app, point it at your Loki, and view logs from the same place you run Rocket.Chat—with optional links back to rooms and users.”

### 1.1 Context: Rocket.Chat’s direction (as of Feb 2026)

- In **Rocket.Chat 8.0.0** (Jan 2026) the built-in Logs tab, Log View Limit, and stdout streaming were **removed** from the app UI for security and reliability reasons, especially for multi-instance/microservices. Related runtime/API pieces (e.g. stdout.queue) were removed.
- **Official recommendation:** Observability at infrastructure level — **Prometheus + Loki + Grafana**. Logs are meant to be viewed in Grafana or via CLI (`docker logs`, `kubectl logs`). Docker Compose and Helm paths support this (e.g. `compose.monitoring.yml`, Launchpad/Helm monitoring stack).
- In **Jan 2026**, Rocket.Chat added a **Grafana “Rocket.Chat Logs” dashboard** (rocketchat-compose#18, helm-charts#223) wired to the existing Loki + OpenTelemetry pipeline — dashboard UX in Grafana, not a return of in-app logs. No roadmap indicates the old in-app Logs UI will come back.
- **Implication for this app:** A marketplace app that provides a **Rocket.Chat-native log/diagnostics experience on top of Loki** is aligned with platform direction: infra stays in Loki/Grafana; the app adds workflow inside RC (RBAC, deep links, incident flow, audited access).

### 1.2 Target users and two modes

Targeting **both** self-hosted ops and SaaS tenants implies **two distinct modes** under one app. Scope and value differ by deployment.

| Audience | Mode | What they get | Prerequisite / constraint |
|----------|------|----------------|---------------------------|
| **Self-hosted (with Loki)** | **Self-hosted Ops** | Raw logs from Loki inside Rocket.Chat; RC-native workflow (deep links to room/user, saved views, audited export, slash command). Does **not** replace Grafana for metrics/traces. | Loki (and optionally Promtail/OTel) already deployed. RC instance can reach Loki. |
| **Self-hosted (without Loki)** | Same mode, but needs onboarding | Same as above after they install a log stack. | Provide a **quickstart** (Compose/Helm snippet or doc) so they can stand up Loki + collector in one go; or support another backend via adapter (e.g. OpenSearch) later. |
| **SaaS tenants** | **SaaS Diagnostics** | **Not** raw server/container logs (marketplace app cannot access host logs). Only what is **exposed by the platform**: app/integration failures, webhook errors, audit events, request correlation IDs, support-bundle-style data. Explicitly “diagnostics / troubleshooting,” not infra logs. | **Blocked until data sources are validated:** Rocket.Chat Cloud (or SaaS) must expose an API or stream for app errors, webhooks, audit, etc. If none exists, SaaS mode is a no-go until RC provides one. |

**Go/no-go:**

- **Worth building** if: primary target is **self-hosted ops** (with or without Loki today) and the app focuses on **RC-native workflow** (incident room, log→room/user pivots, audited access). Self-hosted users who already use Grafana may still use it for metrics/traces; the app wins on “logs and incident flow inside RC.”
- **Not worth building** if: the goal is “raw infra logs for everyone,” including SaaS, without an official logs/diagnostics API from the provider.
- **SaaS mode:** Only pursue after **validating** which SaaS data sources the app can legally and technically query (Rocket.Chat Cloud docs, partner APIs, webhook/audit endpoints). Decide go/no-go for SaaS **before** building that UI.

**Pragmatic product strategy:**

- **v1:** Loki-backed app for **self-hosted** (Single mode: Self-hosted Ops). Ship query safety, required labels, audit, guardrails, packaging spike.
- **v1.5:** One-click or one-doc onboarding for self-hosted users who don’t have Loki yet (templates, Compose/Helm pointers).
- **v2 (optional):** **SaaS Diagnostics** mode only if data sources are validated — explicit “diagnostics console” (app/integration/audit), not “server logs.”

### 1.3 SaaS validation checklist (required before v2)

Before writing SaaS-mode UI, complete this checklist and record outcomes:

- Confirm which diagnostics data is exposed to marketplace apps in SaaS: integration/app failures, webhook delivery/retry errors, audit/security events, request/correlation IDs, and support-bundle equivalents.
- Confirm auth model and scopes for app access in SaaS, including tenant isolation guarantees and least-privilege requirements.
- Confirm data behavior: retention window, freshness/latency, pagination model, and rate limits.
- Confirm compliance and legal boundaries for exposing diagnostics in-product (what can be shown, exported, or linked).
- Define a minimum viable SaaS dataset. If these capabilities are not available, SaaS mode remains no-go and is not shipped.

### 1.4 North star and product guardrails

North star:

- Be the best Rocket.Chat-native diagnostics workflow, not another observability backend.

What this means in practice:

- Keep Loki/Grafana as the backend/system of record for logs, metrics, and traces.
- Optimize for Rocket.Chat-native operations:
  - contextual entry from rooms/threads/users
  - action flows that post directly into incident collaboration spaces
  - explicit RBAC, scope controls, and auditable access
- Prefer features that reduce mean time to triage inside Rocket.Chat before switching tools.

What this explicitly avoids:

- Rebuilding Loki query/storage/retention capabilities.
- Feature parity race with Grafana dashboards/explore workflows.
- Unscoped power-user query surfaces that weaken tenant/environment isolation.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Rocket.Chat                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Log Viewer App (Apps Engine)                                ││
│  │  • Settings (Loki URL, auth, time range defaults)            ││
│  │  • Slash command /logs → opens External Component             ││
│  │  • Private API: /logs/query, /logs/stream (proxy to Loki)     ││
│  │  • Permission: view-logs; audit trail for view/export         ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌───────────────────────────▼──────────────────────────────────┐│
│  │  External Component (Log Viewer UI)                           ││
│  │  • Loaded in CONTEXTUAL_BAR or MODAL (url = app-provided)     ││
│  │  • Calls app’s private API with user’s RC auth                 ││
│  │  • Renders list, filters, search, time range                  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                               │
                   HTTPS (LogQL / query API)
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Loki (single backend for v1; required labels enforced)         │
└─────────────────────────────────────────────────────────────────┘
```

- **Rocket.Chat** runs the app; the app does **not** store logs at scale.
- **Loki** is the only log backend for v1; optional file-tail is a separate experimental adapter (see 5.2).
- The app is a **proxy + UI**: it validates the user (permission `view-logs`), enforces tenant/label scope, builds safe LogQL server-side, and returns results to the External Component. All access and exports are audited.

---

## 3. Rocket.Chat App Design

### 3.1 App surface

- **Slash command:** e.g. `/logs` — opens the Log Viewer (External Component in contextual bar or modal). Only registered for users with the **`view-logs`** permission (see 3.2).
- **External Component:** One component, “Log Viewer”, `location`: `CONTEXTUAL_BAR` or `MODAL`, `url`: points to the app’s UI (see 3.5). **Before committing to app-served UI, a technical spike is required** (see 3.5).
- **Settings (App Settings in RC):**
  - **Loki URL** (string): e.g. `https://loki.example.com`.
  - **Loki auth** (password): optional API key or basic auth password (username in separate setting if needed).
  - **Default time range** (select): e.g. “Last 15 minutes”, “Last 1 hour”, “Last 24 hours”.
  - **Required Loki labels** (see 3.3): e.g. `workspace`, `env`, `service` — key-value pairs or a single label selector that the app **always** injects into every query to enforce tenant/environment scope. No query may run without these.
  - **Operational limits** (optional overrides): max time window, max lines per query, query timeout, per-user rate limit, stream connection cap (see 7).

### 3.2 Permissions and security

- **Dedicated permission:** Use a single permission **`view-logs`**. Assign it to roles as needed (e.g. a “Log viewer” role or grant to admins). Do not rely on “admin-only” as the only gate; this allows finer scoping (e.g. limit to certain workspaces later) and clearer audit.
- **Who can open the viewer:** Only users with `view-logs`. The app checks the caller’s identity on **every** API request (slash command visibility and each `/logs/query`, `/logs/stream`, `/logs/export` call).
- **Scoped access (future):** If Rocket.Chat supports workspace/tenant or room-level permissions, scope `view-logs` accordingly so that “view logs” can be restricted per workspace or environment. v1 can ship with global `view-logs`; design so scope can be tightened without breaking the API.
- **Audit trail (mandatory):** Log every access and export. For each of the following, record at least: **who** (user id), **when** (timestamp), **action** (e.g. `query`, `stream_open`, `stream_close`, `export`), and optionally **scope** (time range, label filter) — **not** log content. Store in app persistence or a dedicated audit collection; retain for a configurable period (e.g. 90 days). Required for marketplace and compliance.
- **API:** Private visibility + secure: only requests that carry a valid Rocket.Chat user token and that user has `view-logs`. App uses RC’s auth (e.g. `X-Auth-Token` / `X-User-Id`).
- **Loki credentials:** Stored in app settings (password type). Sent only from app backend to Loki; never exposed to the client. The External Component only talks to the app’s private API.

### 3.3 Tenant / environment scoping (required Loki labels)

- **Requirement:** Every query sent to Loki **must** be scoped by tenant/environment. Otherwise one workspace could see another’s logs (cross-tenant leakage).
- **Configuration:** App settings define **required Loki labels** (e.g. `workspace`, `env`, `service`). Format: either a fixed label selector (e.g. `{workspace="rc-prod"}`) or a list of label keys whose values are set once per deployment. The app **always** injects these into the LogQL stream selector; the UI must not be able to override or remove them.
- **Server-side only:** Label values come from app settings or environment (e.g. one RC instance = one workspace id). The client never sends raw stream selectors; it only sends allowed parameters (time range, level, text search). The server builds the full LogQL with required labels first, then adds user-supplied filters.
- **Multi-tenant RC:** If Rocket.Chat supports multiple workspaces/tenants, the app should derive the current user’s workspace and add it as a required label so each tenant only sees their own logs. Document the expected label schema (e.g. `workspace`, `env`) in the app README so operators can configure Promtail/log ingestion accordingly.

### 3.4 App API endpoints (backend)

All under the app’s private base path; auth and `view-logs` required. **Query safety:** the client never sends raw LogQL. The server accepts only a strict set of parameters and builds LogQL itself (see §7 Operational guardrails).

- **GET (or POST) `/logs/query`**  
  - **Allowed params only:** `start`, `end` (or `since`), `limit`, `level` (enum: error | warn | info | debug), `search` (single string for full-text search). No `query` or raw LogQL from the client.  
  - Server: validate user → apply **required labels** (3.3) → build LogQL from params (e.g. `{configured_labels} |= "search"` + level filter) → enforce **max time window**, **max lines**, **query timeout** (see §7) → call Loki → return JSON. **Audit:** log action `query` with user, time, scope (time range, level), not log content.
  - **Level normalization policy:** If logs include a structured level field/label, use it. If not, apply a conservative fallback parser (case-insensitive tokens such as `error|warn|info|debug` near message prefix). If no level is detected, classify as `unknown`; these lines are returned only when no level filter is set (or when `unknown` is explicitly supported later).

- **GET `/logs/stream`** (optional, for live tail)  
  - **Allowed params only:** `level`, `search` (optional). Time is “now” and moving forward.  
  - Server: validate user → apply required labels → build LogQL → enforce **stream connection cap** per user and **backpressure** (see §7) → stream from Loki tail API (SSE). **Audit:** log `stream_open` and `stream_close` with user and time.

- **POST `/logs/export`** (if export is implemented)  
  - Same allowed params as query; server returns attachment or stream. **Audit:** log action `export` with user, time, scope.

- **GET `/logs/config`**  
  - Returns non-secret config for the UI: default time range, **allowed** level values, whether fallback level parsing is enabled, max time window, max lines (so UI can show limits). No Loki credentials, no raw label values that could leak tenant info.

### 3.5 External Component (frontend) URL and packaging spike

- **Do not commit to Option A before validating.** Serving a bundled SPA from the Apps Engine (e.g. app’s public/private base + `/log-viewer`) may have constraints: whether apps can register static routes, max bundle size, caching, or CORS. **Before implementation:** run a **technical spike** (1–2 days): create a minimal app that registers an External Component whose `url` points at an app-served route and serves a trivial HTML/JS page. Confirm (1) the External Component loads correctly, (2) the page can call the app’s private API with RC auth, (3) any size or routing limits. Document spike outcome and decide Option A vs B.
- **Option A (preferred if spike succeeds):** UI is bundled and served by the app. External Component `url` = app base + `/log-viewer`. SPA talks only to the app’s private API.
- **Option B (fallback):** UI hosted elsewhere (e.g. S3 + CloudFront). `url` points there; the page receives RC base URL and app hash (or short-lived token) via URL params or postMessage and calls the app’s private API. Use if the spike shows that app-served static assets are not viable.

---

## 4. Features (Worth Doing Well)

Prioritised so the first release is focused and high quality.

### 4.1 Must-have (v1)

- **Time range:** Preset (last 15m, 1h, 24h) and custom (from–to). Must respect server-enforced **max time window** (see §7).
- **Level filter:** Error, Warn, Info, Debug. UI sends only this enum; server maps to LogQL. If logs do not carry a structured level field, server applies the fallback level parser and classifies unmatched lines as `unknown`.
- **Search:** Single free-text field. UI sends as `search` param; server maps to LogQL `|= "..."` (escaped). **No raw LogQL or stream selector in the UI in v1.**
- **List view:** Virtualised list (e.g. `react-window`) so large result sets don’t freeze the UI. Each line: timestamp, level (colour-coded), message. Optional: expand for full raw line or JSON. Client respects **max lines** from `/logs/config`.
- **Pause live tail:** If stream is enabled, a “Pause” toggle so the view doesn’t auto-scroll while the user reads.
- **Copy line / copy selection:** One-click copy of the current line or selected text.
- **Permission:** `view-logs` enforced on slash command and every API call. Audit trail for query, stream, export.

### 4.2 Should-have (v1 or v1.1)

- **Rocket.Chat context links:** Parse log lines for room ID or user ID (from your log format) and render “Open in Rocket.Chat” links (deep link to room or user in RC). Makes the app clearly “Rocket.Chat-native.”
- **Export:** “Download current view” as `.txt` or `.jsonl` (from the data already loaded in the client).
- **Saved views (optional):** Store 2–3 named presets (e.g. “API errors”, “User X”) in app storage or persistence. UI shows a dropdown to load a preset (query + time range + level).

### 4.3 Nice-to-have (later)

- **Structured log viewer:** If logs are JSON, show an expandable tree or table for the current line.
- **Keyboard shortcuts:** `/` focus search, `j`/`k` or arrows for next/previous line, `Esc` clear search.
- **Dark/light theme:** Respect system or RC theme so it’s comfortable for long sessions.

### 4.4 Explicitly out of scope (v1)

- Raw LogQL or stream selector in the UI (strict query builder + server-built LogQL only).
- Full LogQL editor (power users use Grafana).
- Replacing Loki’s retention, compaction, or clustering.
- Alerting (stay in Grafana/Loki).
- File-tail or any non-Loki backend in v1 (see 5.2 for experimental adapter).

---

## 5. Log Source Modes

### 5.1 Loki (only backend for v1)

- **v1 is Loki-only.** App backend has settings: Loki URL, optional auth, **required labels** (3.3).
- All query and stream endpoints translate to Loki’s HTTP API (query range, query tail). Use a small, well-tested Loki client in the app runtime (Node/Deno).
- LogQL is **built only on the server** from: required labels + time range + level filter + text search (e.g. `{workspace="x",env="prod"} |= "search"` + level). No raw LogQL from the client.
- Level filtering prefers structured fields/labels when present. If absent, apply the same conservative fallback parser described in 3.4 and mark unmatched entries as `unknown`.

### 5.2 Experimental adapter: file-tail (not in v1; separate from main flow)

- **Do not ship file-tail in v1.** It is a trap for marketplace quality: no retention, no tenant model, file access and path config vary by deployment, and it encourages skipping Loki. v1 stays Loki-only for a clear, supportable story.
- If needed later, implement file-tail as a **separate experimental adapter**: e.g. an optional app setting “Enable experimental file-tail adapter” (default off). When on, a distinct endpoint or mode serves a live tail from a configured path; no historical query, no required labels (document as “single-tenant, dev-only”). Clearly label in UI and docs as experimental and not for production. This keeps the main path (Loki + required labels + audit) unchanged and avoids diluting v1.

---

## 6. Implementation Phases

1. **Phase 1 – Core**
   - App shell: manifest, settings (Loki URL, auth, default time range), slash command `/logs`, permission.
   - Private API: `/logs/query` (and optionally `/logs/config`). Backend: validate user → call Loki query range → return JSON.
   - External Component: minimal UI (time range, level, search, virtualised list, copy). No stream yet.

2. **Phase 2 – Stream and polish**
   - `/logs/stream` (SSE) to Loki’s tail API; UI: live tail + pause.
   - Rocket.Chat context links (room/user IDs → deep links).
   - Export current view.

3. **Phase 3 – Optional**
   - Saved views (presets).
   - Experimental file-tail adapter (separate from main flow; see 5.2).
   - Structured log view and keyboard shortcuts.

---

## 7. Operational guardrails

These limits must be explicit, configurable where appropriate via app settings, and enforced server-side. Defaults are suggested; operators can tighten or loosen within safe bounds.

| Guardrail | Purpose | Suggested default | Configurable |
|-----------|---------|-------------------|--------------|
| **Max time window** | Prevent unbounded queries that overload Loki or return too much data | 24 hours | Yes (e.g. 1h, 6h, 24h, 7d max) |
| **Max lines per query** | Bound response size and memory | 2000 | Yes |
| **Query timeout** | Fail fast if Loki is slow; avoid hanging requests | 30 s | Yes |
| **Per-user rate limit** | Prevent a single user from hammering the API | e.g. 60 queries/min per user | Yes (or use RC rate limiting if available) |
| **Stream connection cap** | Limit concurrent live tails per user (and optionally global) | 1–2 per user | Yes |
| **Backpressure** | When the client is slow (e.g. SSE buffer full), server should drop frames or close the stream with a clear message instead of unbounded buffering | Drop or close with message | Behavior documented; tune if needed |

- **Enforcement:** All of the above are enforced in the app backend before or during the call to Loki. Return 4xx with a clear error body (e.g. “Time window exceeds maximum 24h”) so the UI can show a message.
- **Config endpoint:** `/logs/config` returns the effective limits (max time window, max lines) so the UI can disable invalid options or show “Load more” / “Narrow time range” when the user hits a limit.

---

## 8. Quality bar

- **Security:** No log data or Loki credentials to the browser; `view-logs` and required labels enforced on every request; audit trail for view/export.
- **Performance:** Virtualised list; all responses bounded by operational guardrails (§7); clear “load more” or time-window messaging when limits apply.
- **Reliability:** If Loki is down or returns an error, show a clear message and optional “Retry,” not a silent failure. Query timeouts and rate limits return explicit errors.
- **Documentation:** README: prerequisites (Loki, required labels), how to configure Promtail/labels for Rocket.Chat, operational limits, and one-page “how to get logs into Loki.”

---

## 9. Summary

- **What it is:** A Rocket.Chat Marketplace app that provides a log/diagnostics viewer inside RC. **v1 = Self-hosted Ops mode only:** Loki-backed, strict query builder (no raw LogQL from UI), required Loki labels, `view-logs` + audit, operational guardrails. Optional later: **SaaS Diagnostics** mode (app/integration/audit data only) **only after** validating that Rocket.Chat SaaS exposes queryable data sources.
- **What it is not:** A replacement for Loki or Grafana; not raw infra logs for SaaS users without a provider API; not file-tail in v1 (file-tail is an optional experimental adapter later).
- **Target users:** Self-hosted ops first (with or without Loki today; offer onboarding for those without). SaaS mode only if data sources are validated first.
- **Before implementation:** (1) Run the **packaging spike** (3.5). (2) Phase 1 = Loki-only for self-hosted. (3) If adding SaaS mode later: validate RC Cloud/SaaS APIs for app errors, webhooks, audit — then decide go/no-go before building that UI.
- **Deliverable (v1):** Install → set Loki URL, auth, and required labels → run `/logs` → view and search logs (with RC context links and export) within enforced limits and with full audit. Self-hosted only; no promise of raw logs for SaaS until a diagnostics API exists.

---

## 10. Rocket.Chat-native differentiators (slash-command workflows)

The app should not compete with Grafana/Loki for advanced observability UI. It should win on **in-chat incident workflow**:

| Command | Purpose inside Rocket.Chat | Why it stands out vs Loki-only usage |
|---------|-----------------------------|--------------------------------------|
| `/logs` | Open viewer pre-scoped by room, environment, or service context | Faster triage from where conversation is already happening |
| `/incident create` | Create incident room from current log scope and invite on-call group | Turns investigation into coordinated response in one action |
| `/logs share` | Post sanitized log snapshot to a thread/channel with permalink | Collaboration artifact stays in chat history |
| `/logs follow <request_id>` | Stream updates for one correlation ID into a thread | Maintains single investigation narrative |
| `/logs runbook` | Map common error signatures to runbook links/checklists | Reduces mean-time-to-mitigation for repetitive failures |
| `/logs ticket` | Create Jira/GitHub ticket prefilled with scope and metadata | Bridges ops triage and engineering backlog |
| `/logs watch` | Temporary watch rule posting to a room on recurring errors | Chat-native alert handoff without full alerting replacement |
| `/logs export` | Export scoped, redacted investigation bundle | Compliance and support handoff with auditability |
| `/logs perms` | Explain access denial (`view-logs`, scope mismatch) | Cuts admin friction during incidents |

Design note: commands should map to audited backend actions (`query`, `stream`, `share`, `export`, `ticket_create`) and obey the same guardrails in section 7.

---

## 11. Delivery complexity and effort (planning baseline)

Complexity is **medium-high** if done to marketplace quality. Indicative estimates for one experienced engineer:

| Delivery slice | Scope | Complexity | Indicative effort |
|----------------|-------|------------|-------------------|
| MVP (self-hosted) | Loki query API, `/logs`, filters, list view, basic RBAC | Medium | 3-6 weeks |
| Production v1 (self-hosted) | Add audit, strict label scoping, export, live tail, limits/rate caps, hardening, docs | Medium-high to High | 8-14 weeks total |
| SaaS Diagnostics mode | Only after API validation; diagnostics datasets + UX + policy controls | High uncertainty | 4-8 additional weeks after validation; can be blocked indefinitely |

Main risk drivers:

- External Component packaging and auth flow details (section 3.5 spike).
- Correct tenant/environment label contract with ingestion pipeline.
- Stream stability, backpressure, and operational limits under load.
- SaaS-mode dependency on provider-exposed diagnostics APIs.

Planning recommendation:

- Commit to v1 self-hosted Loki scope first.
- Treat SaaS Diagnostics as a separate go/no-go milestone after checklist completion (section 1.3).

---

## 12. References (Rocket.Chat logs direction and tooling)

- [Release notes](https://docs.rocket.chat/docs/rocketchat-release-notes) — 8.0.0 removal of Logs tab, Log View Limit, stdout streaming (Jan 2026).
- [Deprecated / phasing out](https://docs.rocket.chat/docs/deprecated-and-phasing-out-features), [Access workspace logs](https://docs.rocket.chat/docs/access-workspace-logs), [Configure workspace logs](https://docs.rocket.chat/docs/configure-workspace-logs).
- [Docker Compose deploy](https://docs.rocket.chat/docs/deploy-with-docker-docker-compose), [rocketchat-compose](https://github.com/RocketChat/rocketchat-compose) — `compose.monitoring.yml`, Loki + OpenTelemetry; PR [#14](https://github.com/RocketChat/rocketchat-compose/pull/14) (Loki/OTel), [#18](https://github.com/RocketChat/rocketchat-compose/pull/18) (Grafana Rocket.Chat Logs dashboard).
- [Helm charts](https://github.com/RocketChat/helm-charts) — monitoring: PR [#220](https://github.com/RocketChat/helm-charts/pull/220) (log collector), [#223](https://github.com/RocketChat/helm-charts/pull/223) (logs dashboard).
- [Launchpad Kubernetes](https://docs.rocket.chat/docs/deploy-with-launchpad) — built-in monitoring stack.
