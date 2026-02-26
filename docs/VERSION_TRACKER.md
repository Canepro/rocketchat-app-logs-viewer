# Version Tracker

Feature-to-version tracking for release discipline and support handoff.

Last updated: 2026-02-26

## 1. Current version state

- `app.json` version: `0.1.1`
- Current packaged artifact name: `logs-viewer_0.1.1.zip`
- Release state:
  - `0.1.1` is the current stable release.
  - `0.1.1-pre` remains as historical pre-release validation tag.

## 2. Released versions

| Version | Date | Status | Feature baseline |
|---------|------|--------|------------------|
| `0.1.1` | 2026-02-26 | Stable | In-chat-private `/logs` UX hardening, snapshot-backed slash actions, `Show copy-ready sample`, `Share sample`, `Share elsewhere` modal flow, full-line-priority copy/share sizing, web row readability controls, private-first API probing, packaging/release/runbook governance |
| `0.1.0` | 2026-02-25 | Pre-release | Core app scaffold, `/logs` command, `/query` `/audit` `/targets` `/threads` `/views` `/actions`, RBAC modes, redaction, rate limit, audit, saved views, polling, row actions, foundational docs and tests |

## 3. Unreleased

Current `Unreleased` scope in `CHANGELOG.md` includes:

- No changes yet.

Release manager note:

- Next cut to stable should bump `app.json` to `0.1.1` and regenerate package/tag.

## 4. Next version recommendation

Recommended next release when scope is accepted:

- Suggested version: `0.1.2` (patch) for incremental fixes, or `0.2.0` for new feature scope.
- Rationale:
  - behavior improvements and reliability hardening
  - no endpoint-contract breaking changes
  - no packaging format break

If additional user-facing features are added before cut (especially web UX upgrades), reassess as `0.2.0`.

## 5. Versioning workflow references

- Release process: `docs/RELEASE_WORKFLOW.md`
- Release checklist: `docs/MARKETPLACE_CHECKLIST.md`
- Changelog source of record: `CHANGELOG.md`
