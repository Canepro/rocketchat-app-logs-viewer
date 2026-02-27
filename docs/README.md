# Documentation Index

Use this index to find canonical docs quickly and avoid drift.

## 1. Core docs (living guides)

1. `docs/DEPLOYMENT_QUICKSTART.md` — first-time install and deploy path (start here if you are new).
2. `docs/SAME_ORIGIN_SETUP.md` — recommended same-origin hosting path for `external_component_url`.
3. `docs/RUNBOOK.md` — install, validation, rollback, and escalation.
4. `docs/USER_GUIDE.md` — operator/end-user usage and troubleshooting.
5. `docs/IMPLEMENTATION.md` — code map and current behavior.
6. `docs/API_CONTRACT.md` — app API schema and auth model.
7. `docs/EXECUTION_PLAN.md` — delivery phases and quality gates.
8. `docs/FRONTEND_REDESIGN_PLAN.md` — frontend roadmap/status.
9. `docs/STACK.md` — Bun + frontend stack standards.
10. `docs/VERSION_TRACKER.md` — released versions and next-cut guidance.
11. `docs/DRIFT_REGISTER.md` — tracked drift and resolution state.

## 2. Release governance docs

1. `docs/RELEASE_WORKFLOW.md` — release lifecycle and acceptance gates.
2. `docs/GITHUB_PUSH_PLAN.md` — branch, PR, tag, and push discipline.
3. `docs/MARKETPLACE_CHECKLIST.md` — marketplace readiness checklist.

Release helper command:

- `bun run release:checklist` (script: `scripts/release-checklist.sh`)

## 3. Version records (historical snapshots)

1. `docs/SMOKE_CHECKLIST.md` — reusable scenario checklist with evidence links.
2. Release notes and PR metadata are tracked in GitHub Releases/PR history and `CHANGELOG.md`.

## 4. Evidence location

- Repository-safe templates and folder structure live under `evidence/`.
- Raw runtime artifacts (HAR, workspace screenshots, raw logs, unredacted notes) must stay in private storage outside git.
- See `evidence/README.md` for handling policy.
