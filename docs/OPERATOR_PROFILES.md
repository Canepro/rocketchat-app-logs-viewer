# Operator Profiles

Recommended configuration profiles for deployment stages.

Last updated: 2026-02-25

## 1. Purpose

Use these profiles as starting points for consistent operations across environments:

- `production`: strongest default posture
- `rollout`: temporary compatibility during RBAC adoption
- `local-dev`: unblock development and local testing

All profiles are templates. Adjust values based on your workspace scale and incident response requirements.

## 2. Profile matrix

| Setting ID | Production | Rollout | Local-dev |
|------------|------------|---------|-----------|
| `logs_source_mode` | `loki` | `loki` | `loki` |
| `workspace_permission_mode` | `strict` | `fallback` | `off` |
| `workspace_permission_code` | `view-logs` | `view-logs` | `view-logs` |
| `allowed_roles` | `admin,log-viewer` | `admin,log-viewer` | `admin` |
| `required_label_selector` | `{job="rocketchat",env="prod"}` | `{job="rocketchat"}` | `{job="rocketchat"}` |
| `enable_redaction` | `true` | `true` | `true` |
| `redaction_replacement` | `[REDACTED]` | `[REDACTED]` | `[REDACTED]` |
| `default_time_range` | `15m` | `15m` | `15m` |
| `max_time_window_hours` | `24` | `24` | `72` |
| `max_lines_per_query` | `2000` | `2000` | `3000` |
| `query_timeout_ms` | `30000` | `30000` | `60000` |
| `rate_limit_qpm` | `60` | `90` | `240` |
| `audit_retention_days` | `180` | `90` | `14` |
| `audit_max_entries` | `10000` | `5000` | `1000` |

Notes:

- `strict` denies requests if workspace permission resolution is unavailable.
- `fallback` still enforces role allowlist but allows role-only authorization if permission lookup fails.
- `off` disables workspace permission checks; keep this mode out of shared/staging/production environments.
- For `strict`, ensure app API requests preserve `x-user-id` + `x-auth-token`, and that `permissions.listAll` is reachable from the app runtime.
- `required_label_selector` examples in this document are templates; always verify actual label keys/values in your Loki dataset before rollout.

## 2.1 Selector discovery checklist (required before production)

1. Query label keys from your Loki endpoint:
   - `GET /loki/api/v1/labels`
2. Query values for candidate keys:
   - `GET /loki/api/v1/label/<name>/values`
3. Build selector from observed values (cluster + namespace is a common stable baseline).
4. Validate with short-window query (`since=15m`) before broad rollout.

Environment example observed during field validation:

- `required_label_selector={cluster="aks-canepro",namespace="rocketchat"}`

## 3. Copy-paste bundles

Set these in Rocket.Chat app settings UI.

### Production

```text
workspace_permission_mode=strict
workspace_permission_code=view-logs
logs_source_mode=loki
allowed_roles=admin,log-viewer
required_label_selector={job="rocketchat",env="prod"}
enable_redaction=true
redaction_replacement=[REDACTED]
default_time_range=15m
max_time_window_hours=24
max_lines_per_query=2000
query_timeout_ms=30000
rate_limit_qpm=60
audit_retention_days=180
audit_max_entries=10000
```

### Rollout

```text
workspace_permission_mode=fallback
workspace_permission_code=view-logs
logs_source_mode=loki
allowed_roles=admin,log-viewer
required_label_selector={job="rocketchat"}
enable_redaction=true
redaction_replacement=[REDACTED]
default_time_range=15m
max_time_window_hours=24
max_lines_per_query=2000
query_timeout_ms=30000
rate_limit_qpm=90
audit_retention_days=90
audit_max_entries=5000
```

### Local-dev

```text
workspace_permission_mode=off
workspace_permission_code=view-logs
logs_source_mode=loki
allowed_roles=admin
required_label_selector={job="rocketchat"}
enable_redaction=true
redaction_replacement=[REDACTED]
default_time_range=15m
max_time_window_hours=72
max_lines_per_query=3000
query_timeout_ms=60000
rate_limit_qpm=240
audit_retention_days=14
audit_max_entries=1000
```

## 4. Verification checklist

After applying a profile:

1. Verify `/logs` command is visible only to intended users.
2. Run one allowed and one denied query to confirm audit entries in `/audit`.
3. Confirm redaction behavior with a known sensitive token pattern in test logs.
4. Validate query limits/window enforcement with intentionally oversized requests.
5. In `strict` mode, validate one successful permission-authorized request and one denied request for a user missing the target permission.
