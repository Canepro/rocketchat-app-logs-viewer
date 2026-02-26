# Execution Plan

Enterprise-grade delivery plan for v1 hardening and controlled feature expansion.

Last updated: 2026-02-26

## 1. Objectives

- Eliminate documentation and implementation drift.
- Raise reliability and security posture to production baseline.
- Deliver Rocket.Chat-native workflows that differentiate from Loki/Grafana without duplicating them.
- Keep roadmap decisions aligned with Rocket.Chat upstream and community signals.

## 1.1 North Star and guardrails

North star:

- Build a Rocket.Chat-centric diagnostics and incident workflow that uses Loki as backend infrastructure.

Scope guardrails:

- In scope:
  - Rocket.Chat-native entry and action workflows (slash context, room/thread actions, auditability)
  - Server-side safety controls (RBAC, selector enforcement, bounded queries, redaction)
  - Fast triage UX inside Rocket.Chat with optional handoff to Grafana/Loki for deep investigation
- Out of scope:
  - Replacing Loki/Grafana as full observability platform
  - Building a generic, unrestricted log exploration engine detached from Rocket.Chat context

Decision filter for new features:

1. Does this make in-Rocket.Chat incident response faster and safer?
2. Does this preserve Loki/Grafana as the system of record for deep observability?
3. Does this strengthen (or at least not weaken) access control, scoping, and auditability?

## 2. Scope baseline

Current implemented baseline:

- Loki-backed query proxy with strict query normalization and guardrails
- Role-gated app API (`/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`)
- Redaction and audit persistence
- `/logs` deep-link workflow with presets and UI prefill/autorun
- React External Component UI with query/audit/room-target/thread-target/saved-view/row-action flows and virtualized results
- Community intelligence register and reference cadence (`docs/COMMUNITY_INTELLIGENCE.md`)

## 3. Delivery phases

## Phase 1: Contract + Security Hardening

Deliverables:

- Authorization hardening:
  - Add `view-logs` permission enforcement to APIs and slash command
  - Keep role allowlist as optional second gate
- API contract stabilization:
  - Publish request/response schema doc for `/config`, `/query`, `/audit`
  - Add backward-compatibility notes for endpoint naming
- Test foundation:
  - Add backend tests for validation, redaction, auth/rate-limit/audit behavior
  - Add slash command parsing tests (preset precedence, warnings, clamping)
- Documentation foundation:
  - Create and maintain user guide for currently shipped functionality
  - Ensure code-level comments exist for non-obvious logic in security-critical paths

Definition of done:

- No high-severity security findings in changed paths
- Tests cover critical behavior and pass locally
- `bun run typecheck` and `bun run build` pass
- Drift register updated for all resolved/new items

## Phase 2: RC-native Workflow Features

Deliverables:

- In-chat experience first (primary):
  - `/logs` response card with high-signal summary (time window, source, count, top errors when available)
  - One-click in-chat actions for triage and collaboration:
    - share evidence
    - incident draft
    - thread note
    - open full viewer only when deeper inspection is needed
  - Clear in-chat failure states:
    - RBAC denied
    - selector/config mismatch
    - empty results
  - Slash presets/workflows optimized for in-chat incident handling
- Web UI second (deep inspection):
  - Query results readability hardening (expand/collapse, pretty/raw JSON, copy affordances)
  - Empty/loading/error state consistency
  - User-facing guardrail message clarity
  - API base probe noise reduction in local/dev workflows
- User guide evolution:
  - Add screenshot-free in-chat-first step-by-step flows
  - Add FAQ/troubleshooting entries for common operator/user failures

Definition of done:

- Workflow actions are audited
- In-chat triage and collaboration workflows are fully usable without forcing immediate context switch to web UI
- UI and command flows documented with examples
- No regression in query security controls

## Phase 3: Operations + Compliance Readiness

Deliverables:

- Operator runbook:
  - Installation, configuration, troubleshooting, rollback
- Policy controls:
  - Label allowlist policy for tenant/environment scoping
  - Configurable redaction policy details
- Release readiness:
  - Changelog and upgrade notes
  - Marketplace submission checklist draft

Definition of done:

- Runbook verified against a clean environment
- Compliance-sensitive behavior (audit/redaction/access) documented end-to-end
- Final drift review shows no unresolved critical drift items

## 4. Quality gates (every phase)

- Architecture: no direct browser access to Loki credentials or raw privileged config
- Security: role/permission checks on every relevant API and command path
- Testing: add tests for each new behavior before considering phase complete
- Documentation: update `README.md`, `docs/IMPLEMENTATION.md`, and drift register in same change set
- Documentation completeness: update `docs/USER_GUIDE.md` and relevant code comments for shipped behavior in same change set
- Release tracking completeness: keep `CHANGELOG.md` and `docs/VERSION_TRACKER.md` aligned with shipped scope
- Verification: `bun run typecheck` and `bun run build` must pass

## 5. Change control

- Any new feature must include:
  - behavior spec in docs
  - tests
  - security impact note
  - drift register review

- If feature scope changes:
  - update this plan first
  - then implement code
  - then update implementation docs

## 6. Phase status snapshot

As of 2026-02-26:

- Phase 1 completed:
  - API contract document (`docs/API_CONTRACT.md`)
  - Test foundation (`tests/` suite for validation/redaction/access-control/slash parsing)
  - Hybrid RBAC authorization model (`view-logs` command permission + API permission modes)
  - Endpoint-level `/threads` behavior tests for auth, membership, and success-path response shaping
  - Endpoint-level negative-path tests for `/actions`, `/query`, and `/audit` (auth, validation, rate-limit, and upstream/error handling branches)
  - Integration-style denied-path audit-write coupling coverage for `/query`, `/actions`, and `/views`
  - Permission model hardening review documented with mode/failure matrix (`docs/RBAC_REVIEW.md`)
- Phase 2 started:
  - Completed:
    - Row action workflow baseline (`POST /actions` + UI actions for `share`, `incident_draft`, and `thread_note`)
    - Action payload validation module and tests (`src/api/logs/actionValidation.ts`, `tests/actionValidation.test.ts`)
    - Audit coverage for allowed/denied row actions
    - Room/thread row-action UX baseline (slash-context quick-fill, readiness indicators, action-specific disable states)
    - Advanced room target UX baseline (`GET /targets` + searchable room target picker in UI)
    - Thread target UX baseline (`GET /threads` + room-scoped searchable thread picker in UI)
    - Saved views baseline (`GET/POST /views` + UI create/apply/update/delete flow)
    - Near-real-time polling baseline (relative mode, bounded interval parse/clamp, explicit start/stop controls, polling stop-on-invalid guards)
    - Viewer-entry UX policy formalized: `/logs` remains non-blocking and context-first; Loki readiness is validated at backend query time with explicit user-facing errors
    - In-chat `/logs` hardening baseline:
      - private contextual-bar summary with timestamped sample lines
      - in-chat action buttons (`Copy sample`, `Share sample`)
      - share-from-slash audit path
      - interaction reliability hardening via server-side user/room resolution
      - sample sizing policy: preview up to 25, copy/share chat output up to 60
      - per-user snapshot-backed slash actions to avoid oversized button payload failures
      - numbered code-block sample rendering for faster in-chat triage
      - numeric severity fallback mapping for common JSON numeric levels
    - Web deep-inspection UX hardening baseline:
      - expandable result rows for long payloads
      - pretty/raw rendering toggle for JSON-style messages
      - wrap on/off control for wide-line scanning
      - row metadata chips (line/char count, preview marker, structured detection)
      - per-row copy line action for evidence handoff
    - API base probe noise reduction:
      - client path resolution now prefers private app endpoint first with public fallback on `404`
  - Remaining:
    - Optional stream-mode design spike (SSE/WebSocket) with security and rate-control review before any server-push implementation
    - Export workflow backlog (`/export`) after stream-vs-polling direction is finalized
- Phase 3 started:
  - Completed:
    - Operator runbook baseline (`docs/RUNBOOK.md`) covering install, validation, rollback, troubleshooting, and escalation data.
    - Marketplace submission checklist baseline (`docs/MARKETPLACE_CHECKLIST.md`) covering packaging, security, QA, docs, and signoff gates.
    - Release governance workflow baseline (`docs/RELEASE_WORKFLOW.md`) with semantic versioning policy, verification gates, and release evidence requirements.
    - Root changelog baseline (`CHANGELOG.md`) with unreleased tracking and initial `0.1.0` entry.
    - Packaging pipeline hardening for monorepo layout (`--experimental-native-compiler` + `.rcappsconfig` ignore policy + devDependency alignment for `@rocket.chat/apps-engine`)
  - Remaining:
    - Final marketplace submission packet assembly and dry-run review.

## 7. Field learnings snapshot (2026-02-26)

- Loki ingress/query route exposure was validated as healthy in the target observability cluster.
- Primary Loki query failure cause was selector mismatch, not ingress/path failure:
  - non-working selector example: `{job="rocketchat"}`
  - working environment selector: `{cluster="aks-canepro",namespace="rocketchat"}`
- `app_logs` source mode worked as expected as no-Loki fallback mode.
- Previous UI pain point addressed in current branch:
  - large/structured log lines now have expand/collapse, pretty/raw rendering, wrap toggle, and copy-line affordances.
- Product sequencing decision after field feedback:
  - prioritize in-chat triage workflow depth first, then web deep-inspection UX improvements.
- In-chat signal-vs-noise sizing decision:
  - keep contextual-bar scan speed high with a 25-line preview
  - allow richer incident evidence handoff with 60-line copy/share output
  - keep button payload compact with snapshot references instead of inline large sample payloads
- These findings are now explicitly reflected in:
  - `docs/RUNBOOK.md` (operational checks and selector diagnosis)
  - `docs/DRIFT_REGISTER.md` (active UX drift items)
  - `docs/USER_GUIDE.md` (known limitations and interim operator guidance)
