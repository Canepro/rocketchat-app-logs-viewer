# Release Workflow

Standard workflow for versioning, changelog updates, package validation, and release evidence.

Last updated: 2026-02-26

## 1. Purpose

This workflow ensures every app release is:

- reproducible
- auditable
- aligned with security and quality gates

Use this process for all production and marketplace-targeted versions.

## 2. Inputs and references

Required references before cutting a release:

1. `docs/MARKETPLACE_CHECKLIST.md`
2. `docs/RUNBOOK.md`
3. `docs/EXECUTION_PLAN.md`
4. `docs/DRIFT_REGISTER.md`
5. `CHANGELOG.md`
6. `docs/VERSION_TRACKER.md`
7. `docs/GITHUB_PUSH_PLAN.md`
8. `docs/RELEASE_NOTES_v0.1.1_DRAFT.md` (or version-matched release notes draft)
9. `docs/SMOKE_CHECKLIST_4PM.md` (or version-matched smoke run sheet)

## 3. Versioning policy

Use semantic versioning:

- `MAJOR`: breaking changes in app behavior or contract
- `MINOR`: backward-compatible feature additions
- `PATCH`: backward-compatible fixes and documentation/test hardening

If uncertain between `MINOR` and `PATCH`, choose `PATCH` only when user-facing behavior is unchanged.

## 4. Release sequence

## 4.1 Prepare release content

1. Confirm scope is complete and linked to plan/drift updates.
2. Update `CHANGELOG.md`:
   - move entries from `Unreleased` into new version section
   - include release date in `YYYY-MM-DD`
   - summarize security, feature, fix, and docs changes
3. Update `app.json` version to the release version.
4. Update `docs/VERSION_TRACKER.md`:
   - move finalized scope from candidate/unreleased into released version row
   - record next-version recommendation
5. Confirm packaging prerequisites:
  - `@rocket.chat/apps-engine` is present in `devDependencies`
  - `.rcappsconfig` ignore list covers non-app workspace paths

## 4.2 Verification gates

Run and record:

1. `bun run test`
2. `bun run typecheck`
3. `bun run build`
4. `bun run package`

If any gate fails, release is blocked.

Packaging note:

- `bun run package` uses `rc-apps --experimental-native-compiler` by design for this workspace layout.

## 4.3 Operational validation

1. Install packaged artifact on a clean workspace.
2. Execute smoke checks from `docs/RUNBOOK.md` section 4.
3. Execute scenario-level run sheet from `docs/SMOKE_CHECKLIST_4PM.md`.
4. Validate checklist items in `docs/MARKETPLACE_CHECKLIST.md`.

## 4.4 Release evidence capture

For each release, capture:

1. version number
2. package checksum (if available in your pipeline)
3. verification command results
4. deployment timestamp
5. approver/signoff names (engineering, security, product, operations)

Store this evidence in your release ticket or release notes record.

## 5. Changelog format

Use this section layout per version:

1. `Added`
2. `Changed`
3. `Fixed`
4. `Security`
5. `Docs`

Keep entries action-oriented and user-impact focused.

## 6. Hotfix workflow

For urgent production issues:

1. Create a `PATCH` release.
2. Keep scope minimal and risk-contained.
3. Update `CHANGELOG.md` with explicit hotfix reason.
4. Run full verification gates (do not skip tests/typecheck/build/package).
5. Re-run runbook smoke checks after deployment.

## 7. Release completion criteria

A release is complete only when:

1. `CHANGELOG.md` and `app.json` version are aligned.
2. `docs/VERSION_TRACKER.md` reflects the released version and feature scope.
3. verification gates passed.
4. runbook smoke checks passed.
5. marketplace checklist items are updated for the release.
6. handoff and drift docs reflect final status.
