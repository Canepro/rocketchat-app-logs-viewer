# Deployment Quickstart

Step-by-step deployment guide for a first-time operator.

Last updated: 2026-02-27

## 1. What you are deploying

This app has two parts:

1. Rocket.Chat app package (`dist/logs-viewer_<version>.zip`)
2. External component web UI (`external_component_url`)

If `external_component_url` is left as `http://localhost:5173`, only the machine running that local dev server can open the UI. For team use, set it to a shared URL.

Recommended production default:

- `external_component_url=https://<rocketchat-host>/logs-viewer/` (same-origin path mode)

## 2. Prerequisites

Before you deploy:

1. You can install private apps in your Rocket.Chat workspace.
2. Bun is installed locally (`bun --version`).
3. You have chosen a source mode:
   - `loki` (recommended for production)
   - `app_logs` (no Loki required, uses Rocket.Chat app logs API)
4. If using `loki` mode:
   - Loki query API is reachable from Rocket.Chat runtime.
   - You know a valid selector for your environment (example: `{cluster="prod",namespace="rocketchat"}`).
5. You have a hosted URL for the web UI (`external_component_url`), not localhost.

## 3. Build and package

From repository root:

```bash
bun install
bun run test
bun run typecheck
bun run build
bun run package
```

Build output notes:

- App package zip: `dist/logs-viewer_<version>.zip`
- Web UI static bundle: `resources/web/`

Verify package output:

```bash
ls -lh dist/logs-viewer_*.zip
```

## 3.1 Host the web UI and pick `external_component_url`

`external_component_url` must point to a URL where `resources/web/` is served over HTTP(S).

Use one of these options:

1. Same-origin path (recommended safe default):
   - serve `resources/web/` at `https://<rocketchat-host>/logs-viewer/`
   - set `external_component_url=https://<rocketchat-host>/logs-viewer/`
   - this avoids cross-origin/CORS complexity for most users
2. External/static host:
   - upload `resources/web/` to static host/CDN and use that URL
   - keep CORS/auth behavior in mind when origin differs from Rocket.Chat
3. Local-only testing:
   - use `http://localhost:5173` with `bun run dev:web`
   - not suitable for shared/team usage

Same-origin setup examples: [`SAME_ORIGIN_SETUP.md`](SAME_ORIGIN_SETUP.md)
Helper script for web asset sync: `bun run deploy:web -- --target <server-path>`

## 4. Deploy the package

Use one method.

## 4.1 Deploy with CLI

```bash
bun run deploy
```

Follow the `rc-apps` prompts for workspace URL and credentials/token.

## 4.2 Deploy with Rocket.Chat Admin UI

1. Open Rocket.Chat Administration.
2. Open private app upload screen (path label varies by Rocket.Chat version).
3. Upload `dist/logs-viewer_<version>.zip`.
4. Enable the app.

## 5. Configure required app settings

Immediately after install, set these values in app settings.

## 5.1 Minimum settings for `loki` mode

```text
logs_source_mode=loki
loki_base_url=https://<loki-host-or-observability-gateway>
required_label_selector={job="rocketchat"}
allowed_roles=admin,log-viewer
workspace_permission_mode=strict
workspace_permission_code=view-logs
external_component_url=https://<rocketchat-host>/logs-viewer/
```

## 5.2 Minimum settings for `app_logs` mode

```text
logs_source_mode=app_logs
allowed_roles=admin,log-viewer
workspace_permission_mode=strict
workspace_permission_code=view-logs
external_component_url=https://<rocketchat-host>/logs-viewer/
```

Notes:

- `loki_base_url` should be host/base only. Do not append `/loki/api/v1/query_range`.
- Keep `workspace_permission_mode=strict` for production.
- `required_label_selector` must match real labels in your Loki data.
- `required_label_selector` is ignored in `app_logs` mode.

## 6. Assign permission and role access

1. Ensure operator users have Rocket.Chat permission `view-logs`.
2. Ensure their role appears in `allowed_roles`.
3. Ensure denied users are not in allowed roles and do not have `view-logs`.

## 7. 5-minute validation

Run these checks right after deployment:

1. Allowed user runs `/logs since=15m limit=200`.
2. Confirm the response is private and **Open Logs Viewer** works.
3. Run a query in the web UI and confirm it returns data (or valid empty result).
4. Click `Show copy-ready sample` and confirm private output.
5. Click `Share sample` and confirm room/thread post succeeds.
6. Denied user attempts `/logs` and is blocked.

If these checks pass, deployment is ready for broader operator use.

## 8. If deployment fails

Start with:

1. [`RUNBOOK.md`](RUNBOOK.md) (install/troubleshooting/rollback)
2. [`OPERATOR_PROFILES.md`](OPERATOR_PROFILES.md) (hardened setting bundles)
3. [`USER_GUIDE.md`](USER_GUIDE.md) (workflow and common errors)
