# RBAC Hardening Review

RBAC and authorization hardening review for Logs Viewer.

Last updated: 2026-02-25

## 1. Scope reviewed

- Slash command authorization:
  - `/logs` command permission gate (`view-logs`)
- App API authorization:
  - `/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`
- Shared authorization module:
  - `src/security/accessControl.ts`
- Test coverage for permission modes and failure branches:
  - `tests/accessControl.test.ts`
  - `tests/logsQueryEndpoint.test.ts`
  - `tests/logsAuditEndpoint.test.ts`

## 2. Effective authorization model

Requests are evaluated in this order:

1. Role allowlist gate (`allowed_roles`)
2. Workspace permission mode gate (`workspace_permission_mode`)

Mode behavior:

- `off`:
  - roles only
- `fallback`:
  - try workspace permission check first
  - if unavailable/failed, allow by role gate and mark access mode as fallback
- `strict`:
  - workspace permission check is required
  - unavailable/failed permission lookup denies request

Permission lookup dependencies:

- auth headers must be present:
  - `x-user-id`
  - `x-auth-token`
- workspace origin must resolve:
  - from `Site_Url` server setting, or
  - from request `host` + `x-forwarded-proto`
- workspace endpoint must be reachable:
  - `GET /api/v1/permissions.listAll`

## 3. Failure mode matrix

| Condition | `off` | `fallback` | `strict` | Reason code |
|-----------|-------|------------|----------|-------------|
| user lacks allowed role | deny | deny | deny | `forbidden_role` |
| permission transport unavailable (missing headers/origin) | allow | allow | deny | `permission_unavailable` |
| permission API check fails | allow | allow | deny | `permission_check_failed` |
| permission record found, user role missing | allow | deny | deny | `forbidden_permission` |

## 4. Review result

- Status: acceptable for production use with documented preconditions.
- Required deployment condition for `strict`:
  - preserve Rocket.Chat auth headers for app API requests and ensure permission API reachability.
- Recommended mode by environment:
  - production: `strict`
  - rollout/migration: `fallback` (temporary)
  - local-dev: `off` or `fallback`

## 5. Verification evidence

Permission-mode and failure-branch coverage is now explicit in tests:

- Access control unit coverage:
  - strict deny on permission unavailability
  - strict deny on permission check failure
  - fallback allow on permission unavailability/check failure
  - strict allow/deny on permission role match mismatch
- Endpoint coverage:
  - `/query`: strict deny + fallback allow when permission check unavailable
  - `/audit`: strict deny + fallback allow when permission check unavailable

## 6. Follow-up hardening (optional)

1. Add integration-style tests that assert audit-write coupling on denied branches across endpoints.
2. Add observability counters for authorization outcomes by reason code.
3. Optionally support additional origin fallback headers (for example `x-forwarded-host`) if required by specific ingress stacks.
