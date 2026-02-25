# Version Tracker

Feature-to-version tracking for release discipline and support handoff.

Last updated: 2026-02-25

## 1. Current version state

- `app.json` version: `0.1.0`
- Current packaged artifact name: `logs-viewer_0.1.0.zip`
- Release state:
  - `0.1.0` is the current baseline release version.
  - Additional features implemented after baseline are tracked in `CHANGELOG.md` under `Unreleased` until next cut.

## 2. Released versions

| Version | Date | Status | Feature baseline |
|---------|------|--------|------------------|
| `0.1.0` | 2026-02-25 | Released | Core app scaffold, `/logs` command, `/query` `/audit` `/targets` `/threads` `/views` `/actions`, RBAC modes, redaction, rate limit, audit, saved views, polling, row actions, foundational docs and tests |

## 3. Unreleased (candidate next release)

Current `Unreleased` scope in `CHANGELOG.md` includes:

- Private in-chat `/logs` response semantics (no room-visible slash output).
- Slash contextual-bar quick triage summary with timestamped sample output.
- In-chat-first actions from slash card:
  - `Copy sample` (private evidence block)
  - `Share sample` (room/thread evidence + audit)
- Sample sizing policy:
  - sidebar preview up to `20` lines
  - copy/share payload up to `50` lines
- Reliability hardening for slash-card actions:
  - server-side user/room resolution for interaction handling
- Numeric severity fallback mapping for common JSON numeric levels in slash summary.
- Packaging hardening and expanded docs/process governance updates.

Release manager note:

- Keep these items in `Unreleased` until a new version is cut and `app.json` is bumped.

## 4. Next version recommendation

Recommended next release when scope is accepted:

- Suggested version: `0.1.1` (patch)
- Rationale:
  - behavior improvements and reliability hardening
  - no endpoint-contract breaking changes
  - no packaging format break

If additional user-facing features are added before cut (especially web UX upgrades), reassess as `0.2.0`.

## 5. Versioning workflow references

- Release process: `docs/RELEASE_WORKFLOW.md`
- Release checklist: `docs/MARKETPLACE_CHECKLIST.md`
- Changelog source of record: `CHANGELOG.md`
