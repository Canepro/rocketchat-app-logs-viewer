# Documentation Index

Use this index to find canonical docs quickly and avoid drift.

## 1. Core docs (living guides)

1. `docs/IMPLEMENTATION.md` — code map and current behavior.
2. `docs/API_CONTRACT.md` — app API schema and auth model.
3. `docs/USER_GUIDE.md` — operator/end-user usage and troubleshooting.
4. `docs/RUNBOOK.md` — install, validation, rollback, and escalation.
5. `docs/EXECUTION_PLAN.md` — delivery phases and quality gates.
6. `docs/FRONTEND_REDESIGN_PLAN.md` — frontend roadmap/status.
7. `docs/STACK.md` — Bun + frontend stack standards.
8. `docs/VERSION_TRACKER.md` — released versions and next-cut guidance.
9. `docs/DRIFT_REGISTER.md` — tracked drift and resolution state.

## 2. Release governance docs

1. `docs/RELEASE_WORKFLOW.md` — release lifecycle and acceptance gates.
2. `docs/GITHUB_PUSH_PLAN.md` — branch, PR, tag, and push discipline.
3. `docs/MARKETPLACE_CHECKLIST.md` — marketplace readiness checklist.

## 3. Version records (historical snapshots)

1. `docs/SMOKE_CHECKLIST.md` — reusable scenario checklist with evidence links.
2. Release notes and PR metadata are tracked in GitHub Releases/PR history and `CHANGELOG.md`.

## 4. Evidence location

- Repository-safe templates and folder structure live under `evidence/`.
- Raw runtime artifacts (HAR, workspace screenshots, raw logs, unredacted notes) must stay in private storage outside git.
- See `evidence/README.md` for handling policy.
