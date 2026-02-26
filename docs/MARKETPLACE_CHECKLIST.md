# Marketplace Checklist

Release-readiness checklist for Rocket.Chat Marketplace submission.

Last updated: 2026-02-26

Execution records:

- `docs/SMOKE_CHECKLIST.md` (latest smoke evidence record)

## 1. Packaging and metadata

- [ ] `app.json` is valid and current (`id`, `name`, `version`, `requiredApiVersion`, `classFile`, `iconFile`).
- [ ] Package builds successfully with `bun run package`.
- [ ] Packaging scripts use native compiler mode (`--experimental-native-compiler`).
- [ ] `.rcappsconfig` ignore rules are present for non-app workspace paths.
- [ ] Artifact installs cleanly on a fresh Rocket.Chat workspace.
- [ ] Version number and release notes are aligned.
- [ ] `CHANGELOG.md` is updated for this release.
- [ ] Repository/support URL fields point to maintained project locations.

## 2. Security and access control

- [ ] All private endpoints require authenticated user context.
- [ ] Role allowlist and workspace permission checks are enforced on all endpoint paths.
- [ ] Production profile uses `workspace_permission_mode=strict`.
- [ ] Loki credentials are never exposed to browser/client.
- [ ] Redaction default is enabled and validated in smoke tests.
- [ ] Audit logging covers allowed and denied critical workflows:
  - query
  - actions
  - saved views
- [ ] Rate limiting is enabled and validated (`429` behavior).

## 3. Functional quality gates

- [ ] `/logs` command and deep-link workflow verified.
- [ ] Query workflow validated for relative and absolute modes.
- [ ] Polling workflow validated (relative only, bounded intervals).
- [ ] Room/thread target discovery validated.
- [ ] Row actions validated (`share`, `incident_draft`, `thread_note`).
- [ ] Saved views lifecycle validated (create/list/update/delete).
- [ ] Audit endpoint filters/pagination validated.

## 4. Test and verification evidence

- [ ] `bun run test` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run build` passes.
- [ ] Security-critical regressions covered by tests in changed paths.
- [ ] Denied-path audit coupling assertions present for core endpoints.

## 5. Documentation completeness

- [ ] README is current with shipped capabilities.
- [ ] API contract is current (`docs/API_CONTRACT.md`).
- [ ] Implementation map is current (`docs/IMPLEMENTATION.md`).
- [ ] User guide is current (`docs/USER_GUIDE.md`).
- [ ] Operator profiles are current (`docs/OPERATOR_PROFILES.md`).
- [ ] Runbook is current (`docs/RUNBOOK.md`).
- [ ] Release workflow is current (`docs/RELEASE_WORKFLOW.md`).
- [ ] Version tracker is current (`docs/VERSION_TRACKER.md`).
- [ ] GitHub push plan is current (`docs/GITHUB_PUSH_PLAN.md`).
- [ ] RBAC review is current (`docs/RBAC_REVIEW.md`).
- [ ] Drift register is updated (`docs/DRIFT_REGISTER.md`).
- [ ] Smoke evidence and release notes are updated (`docs/SMOKE_CHECKLIST.md`, `CHANGELOG.md`).

## 6. Support and operations readiness

- [ ] Troubleshooting matrix reviewed with support/on-call owners.
- [ ] Rollback package and procedure validated.
- [ ] Escalation template includes required diagnostics data.
- [ ] Known limitations documented (no server-push stream, no export endpoint in v1).

## 7. Go/No-Go signoff

Record explicit approvals before submission:

- [ ] Engineering signoff
- [ ] Security signoff
- [ ] Product signoff
- [ ] Operations signoff
