# GitHub Push Plan

Professional push plan for publishing this workspace safely and with traceability.

Last updated: 2026-02-25

## 0. Current repository state

As of this update, `/mnt/d/repos/rocketchat-app-logs-viewer` has no `.git` directory.
This means the first push must follow the **Initial publication track** in section 2.

## 1. Preconditions

Before push:

1. Documentation alignment is complete:
   - `README.md`
   - `docs/IMPLEMENTATION.md`
   - `docs/USER_GUIDE.md`
   - `docs/RUNBOOK.md`
   - `docs/EXECUTION_PLAN.md`
   - `docs/DRIFT_REGISTER.md`
   - `docs/HANDOFF.md`
   - `docs/VERSION_TRACKER.md`
   - `CHANGELOG.md`
2. Local verification gates passed:
   - `bun run test`
   - `bun run typecheck`
   - `bun run build`
   - `bun run package`
3. Release intent is clear:
   - keep as in-progress branch work, or
   - cut next release and bump `app.json` version.

## 2. Push tracks

### Track A: Initial publication (no local git repo yet)

1. Initialize repo and default branch:
   - `git init`
   - `git checkout -b main`
2. Stage current project:
   - `git add .`
3. Create initial commit:
   - `git commit -m "chore: initialize logs viewer app workspace"`
4. Create empty GitHub repo under personal namespace (example):
   - `gh repo create canepro/rocketchat-app-logs-viewer --private --source=. --remote=origin --push`
5. Verify remote:
   - `git remote -v`
6. Confirm GitHub default branch is `main`.

### Track B: Ongoing pushes (repo already initialized)

1. Sync from remote:
   - `git fetch origin`
   - `git checkout main`
   - `git pull --ff-only origin main`
2. Create feature branch:
   - `git checkout -b feature/<scope>`
3. Commit changes in reviewable units.
4. Push branch and open PR:
   - `git push -u origin feature/<scope>`
   - `gh pr create --fill`

## 3. Branch strategy

Use one feature branch for each coherent change set.

Examples:

- `feature/in-chat-triage-docs-and-release-tracking`
- `feature/web-log-readability-v0.1.1`

## 4. Commit strategy

Use small, auditable commits grouped by concern:

1. `docs: align user/operator docs with in-chat private triage behavior`
2. `feat: harden slash-card actions and sample sizing policy`
3. `test: add slash-card action and numeric-level mapping coverage`
4. `docs: add version tracker and github push plan`

## 5. Pull request scope

PR title example:

- `feat(logs-viewer): in-chat triage hardening + version/documentation alignment`

PR description should include:

1. Problem statement
2. Behavior changes (user-visible + operator-visible)
3. Security/authorization impact
4. Test evidence (exact commands + result)
5. Docs updated list
6. Rollback plan (disable app / revert package version)

## 6. Review checklist

Before merge:

1. Confirm no secret values in committed files.
2. Confirm `app.json` version and `CHANGELOG.md` are intentionally aligned.
3. Confirm `docs/VERSION_TRACKER.md` reflects current release status.
4. Confirm package artifact can be generated from clean checkout.
5. Confirm private `/logs` behavior and slash-card action semantics are documented and tested.

## 7. Merge and tag workflow

If releasing immediately:

1. Merge PR to `main`.
2. Bump `app.json` version (if needed) and finalize `CHANGELOG.md` release section.
3. Create annotated tag:
   - `git tag -a v0.1.1 -m "release: v0.1.1"`
4. Push branch + tag:
   - `git push origin main --tags`
5. Attach packaged zip and verification evidence to release record.

If not releasing yet:

1. Merge PR without tag.
2. Keep changes under `Unreleased` in `CHANGELOG.md`.
3. Keep `app.json` at current baseline version.

## 8. Post-push validation

After push/merge:

1. Re-run packaging from fresh clone.
2. Install package on a validation workspace.
3. Run runbook smoke checks (`docs/RUNBOOK.md` section 4).
4. Record outcomes in release ticket and update `docs/HANDOFF.md`.
