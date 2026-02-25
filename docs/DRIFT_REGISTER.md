# Drift Register

This document tracks intentional and unintentional drift between product design docs and implemented code.

Last updated: 2026-02-25

## Source-of-truth order

1. Implemented code in `src/` and `web/src/`
2. `docs/IMPLEMENTATION.md` (current behavior)
3. `docs/EXECUTION_PLAN.md` (approved forward plan)
4. `DESIGN.md` (target architecture and strategy)

If two docs conflict, use this order and open/update a drift item.

## Active drift items

| ID | Area | Design / expectation | Current implementation | Decision | Target phase |
|----|------|----------------------|------------------------|----------|--------------|
| DR-002 | Endpoint naming | Design examples use `/logs/query`, `/logs/config`, `/logs/audit` | App API paths are `/query`, `/config`, `/audit`, `/targets`, `/threads`, `/views`, `/actions` | Keep current paths for v1, document canonical paths in implementation docs, and avoid mixed examples in future docs | Phase 1 |
| DR-003 | v1 feature definition | Design lists stream/export in core v1 narrative | Current app ships query/config/audit, slash deep links, row actions, targets/threads, saved views, and UI polling; no stream/export endpoint | Re-scope stream/export to v1.1 backlog until tests and security hardening baseline are complete | Phase 2 |
| DR-004 | Query results UX readability | Viewer should enable fast triage of long/structured log lines (expandable details, readable formatting) | Current results panel returns data correctly but is difficult to parse for large JSON-heavy lines in day-to-day ops | Prioritize UI readability hardening in Phase 2 continuation (expand/collapse, pretty/raw toggle, copy affordances) before release candidate freeze | Phase 2 |
| DR-005 | Local API probe noise | Local dev/prod diagnostics should avoid misleading endpoint errors in browser console | Client candidate probing can emit expected `404` while falling back across public/private app API paths | Keep fallback behavior but reduce operator confusion: prefer private-first probing when appropriate and suppress expected probe noise in UI docs/telemetry | Phase 2 |

## Closed drift items

| ID | Area | Resolution |
|----|------|------------|
| DR-C001 | Preset documentation | README + implementation docs now document supported presets and precedence rules |
| DR-C002 | Slash deep-link behavior | Slash command + UI prefill/autorun behavior documented and aligned with implementation |
| DR-C003 | Stack docs | `docs/STACK.md` now marks Zod as optional/planned instead of currently implemented |
| DR-C004 | Roadmap freshness | Implementation sequence updated to focus on unresolved hardening/workflow work, not already shipped preset work |
| DR-C005 | User guide coverage | Added `docs/USER_GUIDE.md` and linked it from README/implementation docs |
| DR-C006 | Authorization model | Implemented hybrid RBAC model: slash command requires `view-logs`, app APIs support permission check modes (`off`, `fallback`, `strict`) with role allowlist gate |
| DR-C007 | API contract drift | Added `docs/API_CONTRACT.md` to define canonical endpoint contract and compatibility notes |
| DR-C008 | RC-native row actions | Implemented `share`, `incident_draft`, and `thread_note` row actions with `/actions` endpoint, strict validation, audit logging, and UI integration |
| DR-C009 | Room target UX gap | Implemented user-scoped `/targets` endpoint and searchable room target picker to reduce manual room ID targeting errors |
| DR-C010 | Thread target UX gap | Implemented room-scoped `/threads` endpoint and searchable thread target picker to reduce manual thread ID targeting errors |
| DR-C011 | Endpoint test coverage gap | Added endpoint-level negative-path tests for `/actions`, `/query`, and `/audit`, plus `/threads` endpoint behavior tests for auth/membership/success-path shaping |
| DR-C012 | RBAC hardening review gap | Added `docs/RBAC_REVIEW.md` with permission-mode behavior, failure matrix, deployment conditions, and verification evidence |
| DR-C013 | Saved views workflow gap | Added user-scoped `/views` endpoint (list/create/update/delete), strict payload validation, audit actions, UI workflow, and test coverage |
| DR-C014 | Polling workflow gap | Added near-real-time polling controls in Query UI with interval bounds, start/stop behavior, validation-stop safeguards, and helper test coverage |
| DR-C015 | Denied-path audit coupling test gap | Added integration-style endpoint tests asserting denied authorization branches write expected audit actions for `/query`, `/actions`, and `/views` |
| DR-C016 | Operations runbook and release checklist gap | Added `docs/RUNBOOK.md` and `docs/MARKETPLACE_CHECKLIST.md` with deployment, rollback, troubleshooting, escalation, and submission readiness gates |
| DR-C017 | Release notes/changelog governance gap | Added `docs/RELEASE_WORKFLOW.md` and root `CHANGELOG.md`, including versioning policy, verification gates, and release evidence requirements |
| DR-C018 | Packaging pipeline stability gap | Resolved `rc-apps package` failures (`startsWith`, workspace module resolution) via `@rocket.chat/apps-engine` devDependency alignment, native compiler package/deploy scripts, and `.rcappsconfig` ignore policy for workspace-only paths |
| DR-C019 | Command vs Loki readiness expectation | Aligned docs and implementation policy: `/logs` is a fast, context-aware entrypoint; Loki configuration is enforced at viewer/query time with explicit runtime error messaging |
| DR-C020 | Community/upstream signal tracking gap | Added `docs/COMMUNITY_INTELLIGENCE.md` with official/community sources, decision implications, and review cadence; linked from README/plan/handoff |
| DR-C021 | In-chat workflow depth | Implemented private slash contextual-bar triage summary with timestamped samples, in-chat copy/share actions, audited share flow, and updated docs/runbook coverage |
