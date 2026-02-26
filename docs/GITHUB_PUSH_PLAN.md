# GitHub Push Plan

Professional push and branch strategy for ongoing delivery after `v0.1.1`.

Last updated: 2026-02-26

## 0. Current repository state

- Repository is initialized and connected:
  - remote: `origin=https://github.com/Canepro/rocketchat-app-logs-viewer.git`
  - default branch: `main`
- Latest stable cut is on `main`:
  - app version: `0.1.1`
  - tags: `v0.1.1-pre` and `v0.1.1`
  - merged delivery PR: `#1`

## 1. Preconditions before each push

1. Documentation alignment is complete:
   - `README.md`
   - `docs/IMPLEMENTATION.md`
   - `docs/USER_GUIDE.md`
   - `docs/RUNBOOK.md`
   - `docs/EXECUTION_PLAN.md`
   - `docs/DRIFT_REGISTER.md`
   - `docs/SMOKE_CHECKLIST.md`
   - `docs/VERSION_TRACKER.md`
   - `CHANGELOG.md`
2. Local verification gates passed (when code changes are included):
   - `bun run test`
   - `bun run typecheck`
   - `bun run build`
   - `bun run package`
3. Release intent is explicit:
   - `Unreleased` update only, or
   - version cut (`0.1.2`/`0.2.0`) with changelog + tag.

## 2. Parallel branch model

Use two active workstreams to avoid frontend/backend drift:

1. Frontend design branch:
   - name pattern: `feature/web-*`
   - scope: `web/**`, frontend UX docs, style/readability behavior
2. Backend/reliability branch:
   - name pattern: `feature/app-*` or `docs/*`
   - scope: `src/**`, tests, release/runbook/ops docs

Merge policy:

1. Rebase/merge `main` into both branches daily.
2. Keep PR scope single-purpose.
3. Merge backend/reliability fixes ahead of large frontend restyling when conflicts appear.

## 3. Standard branch workflow

1. Sync:
   - `git fetch origin`
   - `git checkout main`
   - `git pull --ff-only origin main`
2. Create branch:
   - `git checkout -b feature/<scope>`
3. Commit in reviewable units:
   - `git add <files>`
   - `git commit -m "<type>: <summary>"`
4. Push and open PR:
   - `git push -u origin feature/<scope>`
   - `gh pr create --fill`

## 4. Commit strategy

Prefer small, auditable commits grouped by concern.

Examples:

1. `docs: align release and handoff state for v0.1.1`
2. `fix(app): harden slash share flow for message size limits`
3. `feat(web): improve query row readability controls`
4. `test: add regression coverage for slash card actions`

## 5. Review checklist

Before merge:

1. Confirm no secrets in staged files.
2. Confirm behavior/docs/test alignment in same PR.
3. Confirm `CHANGELOG.md` and `docs/VERSION_TRACKER.md` are aligned to intent.
4. Confirm package still builds from clean checkout.
5. Confirm in-chat private `/logs` behavior remains intact.
6. Confirm GitHub CI workflow is green for the branch/PR.

## 6. Tag and release workflow

When cutting a stable release:

1. Merge release PR to `main`.
2. Bump `app.json` version.
3. Finalize version section in `CHANGELOG.md`.
4. Build package and record checksum.
5. Tag and push:
   - `git tag -a v<version> -m "release: v<version>"`
   - `git push origin main --tags`
6. Publish GitHub release and attach artifact + evidence links.

## 7. Post-merge validation

1. Re-run package from fresh checkout.
2. Install artifact in validation workspace.
3. Run runbook smoke checks.
4. Record results in:
   - `docs/SMOKE_CHECKLIST.md`
   - `CHANGELOG.md`
   - GitHub release notes (or release ticket for private repos).
