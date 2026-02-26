# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Release governance documentation:
  - `docs/RELEASE_WORKFLOW.md`
  - `docs/RUNBOOK.md`
  - `docs/MARKETPLACE_CHECKLIST.md`

### Changed

- Phase tracking and handoff docs aligned with Phase 1 completion and Phase 3 start.
- Packaging/deploy scripts now use `rc-apps` native compiler mode.
- `/logs` command responses are now private to the invoking user (private contextual bar primary path, user-only notification fallback), with no room-visible output message.
- `/logs` private quick triage summary now includes timestamped sample output lines:
  - sidebar preview up to 25 lines
  - copy/share chat output up to 60 lines
- `/logs` private slash card now includes in-chat actions:
  - `Copy sample` for private copy-ready evidence output
  - `Share sample` to publish sampled lines to the current room/thread with audit logging
- Slash summary severity detection now maps common numeric JSON levels (for example 20/30/35/40/50) to semantic levels for higher signal.
- Slash summary sample output now renders as a numbered code block for faster in-chat scanning and ticket paste accuracy.
- Slash summary preview now applies a chat-size safety cap to avoid oversized contextual-bar block payloads.
- Query results panel readability baseline improved for large payload triage:
  - pretty/raw message view toggle
  - wrap on/off control
  - per-row expand/collapse
  - per-row copy line action
  - row metadata chips (line/char count + structured marker)
- Browser app API candidate resolution now prefers private endpoint first with public fallback to reduce expected local `404` probe noise.

### Fixed

- Resolved `bun run package` failures caused by:
  - `@rocket.chat/apps-engine` manifest lookup mismatch (must be under `devDependencies`)
  - workspace monorepo file scanning (non-app `web/**` and `tests/**` paths now ignored via `.rcappsconfig`)
- Hardened slash-card action reliability by resolving user/room context server-side when interaction payload fields are incomplete.
- Hardened slash-card action reliability by persisting per-user sample snapshots and using compact snapshot references in button payloads.
- Added stale snapshot fail-safe guidance in action responses (`Run /logs again`) instead of silent copy/share failures.
- Enforced slash sample snapshot TTL at read-time to prevent stale snapshot reuse after long idle periods.

### Security

- Added denied-path audit coupling test assertions for `/query`, `/actions`, and `/views`.

### Docs

- Updated README and implementation references for new operations and release docs.
- Added explicit version-to-feature tracking (`docs/VERSION_TRACKER.md`) and GitHub publication plan (`docs/GITHUB_PUSH_PLAN.md`).
- Captured field-validation learnings from live Loki-mode testing:
  - selector mismatch root cause and working selector example
  - ingress-query-path verification outcome
  - `app_logs` fallback confirmation
- Re-aligned plan/handoff/drift docs with next-priority UX hardening work (results readability and row-detail expandability).
- Re-prioritized Phase 2 sequencing to in-chat-first workflow depth, then web deep-inspection UX.

## [0.1.0] - 2026-02-25

### Added

- Initial Rocket.Chat logs viewer scaffold:
  - private endpoints: `/health`, `/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`
  - `/logs` slash command with deep-link prefill and presets
  - React external component UI with query, audit, row actions, target discovery, saved views, and polling workflows
- Security controls:
  - role and workspace permission gating
  - rate limiting
  - audit logging
  - response redaction
- Test coverage for validation, endpoint negative paths, RBAC mode behavior, and workflow modules.

### Changed

- Default authorization posture documented as `workspace_permission_mode=strict`.

### Docs

- Added API contract, user guide, implementation map, operator profiles, RBAC review, drift register, and handoff docs.
