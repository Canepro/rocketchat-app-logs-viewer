# Version Tracker

Feature-to-version tracking for release discipline and support handoff.

Last updated: 2026-02-26

## 1. Current version state

- `app.json` version: `0.1.0`
- Current packaged artifact name: `logs-viewer_0.1.0.zip`
- Release state:
  - `0.1.0` is the current baseline pre-release version.
  - Additional features implemented after baseline are tracked in `CHANGELOG.md` under `Unreleased` until next cut.

## 2. Released versions

| Version | Date | Status | Feature baseline |
|---------|------|--------|------------------|
| `0.1.0` | 2026-02-25 | Pre-release | Core app scaffold, `/logs` command, `/query` `/audit` `/targets` `/threads` `/views` `/actions`, RBAC modes, redaction, rate limit, audit, saved views, polling, row actions, foundational docs and tests |

## 3. Unreleased (candidate next release)

Current `Unreleased` scope in `CHANGELOG.md` includes:

- Private in-chat `/logs` response semantics (no room-visible slash output).
- Slash contextual-bar quick triage summary with timestamped sample output.
- In-chat-first actions from slash card:
  - `Copy sample` (private evidence block)
  - `Share sample` (room/thread evidence + audit)
- Sample sizing policy:
  - sidebar preview up to `25` lines (with chat-size safety cap)
  - copy/share chat output up to `60` lines
- Slash-card action payload reliability hardening:
  - per-user persisted sample snapshots
  - compact snapshot ID references in button payloads
  - stale snapshot fail-safe response prompting rerun of `/logs`
  - snapshot TTL enforced at read time to prevent stale snapshot reuse
- Readability hardening:
  - numbered code-block formatting for copy/share and slash preview sample lines
- Web deep-inspection readability hardening:
  - pretty/raw message rendering mode
  - wrap on/off toggle
  - per-row expand/collapse and copy line
  - row metadata chips for line/char counts and structured detection
- API probe-noise hardening:
  - browser app API path resolution changed to private-first with public fallback
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
