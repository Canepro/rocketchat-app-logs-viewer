# User Guide

End-user and operator guide for the current Logs Viewer app behavior.

Last updated: 2026-02-26

## 1. What this app does

- Opens a Rocket.Chat-native logs workflow via `/logs`
- Queries Loki through the app backend (`/query`) with guardrails
- Supports level/search/time filters and deep-link prefill from slash command
- Supports saved query presets through user-scoped saved views (`/views`)
- Shows audit history (`/audit`) for authorized users

This app complements Loki/Grafana; it does not replace them.

## 2. Prerequisites

- App installed in Rocket.Chat
- `logs_source_mode` set appropriately:
  - `loki` (default): Loki reachable from Rocket.Chat app runtime
  - `app_logs`: Rocket.Chat app logs API access allowed for requesting users
- For `loki` mode:
  - `loki_base_url` points to Loki base host (for example `https://observability.canepro.me`), not a full query path
  - upstream ingress/proxy exposes Loki read path used by app (`/loki/api/v1/query_range`)
- Required app settings configured:
  - Logs source mode
  - Loki URL
  - Required label selector
  - External Component URL
- Your user has an allowed role from app setting `allowed_roles`
- For `/logs` command visibility, user should have Rocket.Chat permission `view-logs`
- If `workspace_permission_mode` is enabled (`fallback` or `strict`), user must match `workspace_permission_code` (default `view-logs`)

## 2.2 First-time user quickstart

If this is your first use in a workspace:

1. Ask an admin to confirm your role is included in `allowed_roles`.
2. Go to a room/DM where you are reproducing an issue.
3. Run `/logs since=15m limit=500`.
4. Validate private response behavior:
   - contextual bar opens privately
   - quick triage summary appears
   - sample output preview appears (up to 25 lines)
5. Click `Show copy-ready sample` for a private evidence block.
6. Click `Share sample` when you want room/thread-visible evidence for team triage.
7. Click **Open Logs Viewer** for deeper filtering, saved views, and audit review.

## 2.1 RBAC mode recommendation

App default is `workspace_permission_mode=strict` with `workspace_permission_code=view-logs`.

| Profile | `workspace_permission_mode` | Use case |
|---------|-----------------------------|----------|
| Production (recommended default) | `strict` | Enforce permission checks on every request; deny when permission lookup is unavailable. |
| Rollout / migration (temporary) | `fallback` | Keep role gate while permission checks are being validated in your environment. |
| Local development only | `off` or `fallback` | Unblock setup/testing when strict mode is not practical. |

For full copy-paste environment profiles, see `docs/OPERATOR_PROFILES.md`.

## 3. Open the viewer

Use slash command:

- `/logs`
- `/logs since=30m level=error`
- `/logs preset=incident`

`/logs` response visibility:

- The `/logs` response is private to the invoking user.
- The app attempts to open a private contextual bar first.
- If contextual-bar open is unavailable in the current client context, it falls back to a user-only notification containing the deep link.
- The command does not post a room-visible message to channel/group/team contexts.
- Room/thread-aware context intent:
  - if `/logs` is executed in a room timeline, actions target that room
  - if `/logs` is executed in a thread, actions target that same thread first
  - if thread publish fails (deleted/mismatch), share falls back to the room timeline
  - copy action is always private user-only output
- The private response includes a quick triage summary:
  - source mode
  - requested time window
  - sampled line count (capped)
  - top detected levels
  - top repeated signal lines
  - timestamped sample output lines:
    - sidebar preview: up to 25 lines (truncated), with additional chat-size cap when needed
    - copy/share actions: up to 40 lines rendered in chat with `full_line_priority` mode (fewer lines, richer line text)
    - action samples are resolved from a per-user persisted snapshot (compact button payload)
  - in `app_logs` mode, quick sample output is intentionally unavailable in slash response
- The private slash card includes in-chat actions:
  - `Show copy-ready sample`: sends a private copy-ready code block with sampled lines.
    - Clipboard writes are not supported from Rocket.Chat Apps server-side actions; copy manually from the returned block.
    - Render mode is `full_line_priority`: fewer lines are shown to preserve richer per-line evidence.
  - `Share sample`: posts sampled lines into the current room/thread and records a share audit entry.
  - `Share elsewhere`: opens a private modal that lets you:
    - choose target room by room ID or room name
    - optionally provide a thread ID in that target room
    - submit and post sampled lines with audit entry
    - if thread publish fails, app falls back to room timeline

## 3.1 Fast-entry behavior (intentional)

- `/logs` is designed as a fast entrypoint and does **not** require Loki settings to be complete before opening the viewer.
- The command validates user authorization and External Component URL, then opens context-aware UI quickly.
- Loki readiness is enforced when the viewer calls backend endpoints (for example `/query`).
- If Loki is not configured, users will see a clear config error such as `Loki base URL is not configured.`
- This behavior is intentional to keep the diagnostics workflow responsive from any room/thread context.

## 4. Supported slash arguments

- `preset`: `incident`, `webhook-errors`, `auth-failures`
- `since`: relative duration (example: `15m`, `1h`, `24h`)
- `start` / `end`: absolute timestamps (ISO-like datetime parseable by JS date)
- `level`: `error`, `warn`, `info`, `debug`
- `limit`: positive integer
- `search`: text filter
- `run` or `autorun`: run query automatically on open

Rules:

- Explicit args override preset defaults.
- If both `start/end` and `since` are provided, `start/end` wins.
- Invalid args are ignored and reported as warnings in the slash response.

## 5. Preset defaults

- `incident`: `since=30m`, `level=error`, `limit=300`
- `webhook-errors`: `since=2h`, `level=error`, `limit=400`, `search=webhook`
- `auth-failures`: `since=1h`, `level=warn`, `limit=300`, `search=auth failed`

## 6. Using the UI

## Query panel

- Choose `relative` or `absolute` time mode
- Set level/search/limit
- Click **Run query**
- Optional: set **Polling interval (sec)** and use **Start live polling** / **Stop live polling** for near-real-time refreshes
- Live polling currently supports **relative** time mode
- Polling interval is clamped to a safe range of **5s to 300s** (default **15s**)

The UI enforces basic client validation. Backend still enforces authoritative limits.

## Results panel

- Results are virtualized for performance
- Each row shows level, timestamp, message metadata (`chars`, `lines`, format), and label chips
- Message readability controls are available:
  - `Message view`: `Pretty (JSON-aware)` or `Raw`
  - `Wrap: on/off` for long-line scanning
  - per-row `Expand details` / `Collapse details`
  - per-row `Copy line`
- Results readability is optimized for incident triage:
  - high-contrast monospace message surface
  - level-accented row rails and alternating row tones
  - long label chips are truncated visually; hover to view full value
- Collapsed mode shows a bounded preview for scan speed; expanded mode shows full message + more labels
- Redaction metadata is shown in query summary when applicable

## Row actions

- Use **Room target search** to find accessible rooms and click a room chip to set target room quickly.
- After choosing a room, use **Thread target search (selected room)** to load active threads for that room and click a thread chip to set thread target quickly.
- Set **Action target room ID** (and optional/required **thread ID**) in the results section.
- Use **Use slash room target** or **Use slash thread target** to quickly apply deep-link context.
- Use **Share to room** on a row to post a concise log summary.
- Use **Create incident draft** on a row to post an incident template with evidence.
- Use **Add thread note** on a row to post into an existing thread (`targetThreadId` required).
- Target readiness badges show whether room/thread targets are ready before running actions.
- Row actions are server-side authorized, rate-limited, and audit logged.

## Audit panel

- Filter by `userId` and `outcome`
- Set `limit` and refresh
- View allowed/denied query history (action success automatically triggers audit refresh)

## Saved views panel

- Set your current query filters (time mode/range, limit, level, search).
- Enter a **Saved view name**.
- Click **Save current as new** to persist a reusable query preset.
- Select an existing saved view, then click **Apply** to load it into the query form.
- Use **Update selected** to overwrite the selected saved view with current form values.
- Use **Delete selected** to remove the selected saved view.
- Saved views are user-scoped and audited through app endpoint <code>/views</code>.

## 7. Troubleshooting

## “Insufficient role” errors

- Ensure your role is listed in `allowed_roles` app setting.

## “Loki base URL is not configured”

- Set `loki_base_url` in app settings.
- This can appear even when `/logs` and the **Open Logs Viewer** button work; command access and Loki readiness are separate checks by design.

## “Required label selector is invalid”

- Set `required_label_selector` to a valid selector format like `{job="rocketchat"}`.

## Query rejected for limit/window

- Lower `limit` or narrow time range.
- Check configured guardrails in app settings.

## Row action failed (room/thread)

- Confirm target room ID exists and you are a member of that room.
- If using thread ID, ensure the thread belongs to the same target room.
- `Add thread note` requires a thread ID; provide `targetThreadId` before running the action.
- Verify your role and `view-logs` permission allow logs actions.
- If room target search is empty, broaden search text or click **Refresh**.
- If thread target search is empty, confirm a room is selected first, broaden thread search text, then click **Refresh**.

## Empty results

- Confirm labels used in `required_label_selector` match your Loki ingestion labels.
- Try wider time range and remove search/level filters temporarily.
- If needed, verify labels directly from Loki (`/loki/api/v1/labels` and `/loki/api/v1/label/<name>/values`) and update selector to observed values.

## Query failed with `404` from Loki

- Confirm `loki_base_url` is host-only (for example `https://observability.canepro.me`).
- Confirm upstream ingress/proxy exposes Loki query path `/loki/api/v1/query_range`.
- If only `/loki/api/v1/push` is exposed, ingestion can work while viewer queries fail.

## Query failed with `400` from `/query`

- Check the query error `details` shown in UI under the query panel.
- Common causes:
  - `loki` mode with invalid `required_label_selector` (must look like `{job="rocketchat"}` with no pipeline)
  - `loki` mode with missing `loki_base_url`
  - invalid request payload values (`since`, `start/end`, `limit`, `level`)
- If you use `app_logs` mode, ensure request auth headers are present and workspace origin is resolvable.

## Local dev shows CORS errors (`localhost:5173`)

- Two supported local-dev modes:
  - Cookie mode: `VITE_ROCKETCHAT_API_ORIGIN=https://<rocketchat-host> bun run dev:web`
    - Uses direct-origin browser calls and Rocket.Chat session cookies.
    - Requires Rocket.Chat CORS to allow `http://localhost:5173`.
  - Token mode (recommended): set all of these when starting dev server:
    - `VITE_ROCKETCHAT_API_ORIGIN=https://<rocketchat-host>`
    - `VITE_ROCKETCHAT_USER_ID=<rc-user-id>`
    - `VITE_ROCKETCHAT_AUTH_TOKEN=<personal-access-token-or-auth-token>`
    - Then run `bun run dev:web`
    - Browser calls stay same-origin and Vite proxy forwards auth headers to Rocket.Chat.
    - The client tries app API bases in order: `/api/apps/private/<appId>` then `/api/apps/public/<appId>` (404 fallback).
- If your workspace uses tokenized private routes, set:
  - `VITE_ROCKETCHAT_APP_API_BASE_PATH=<exact-base-path>`
- Restart the dev server after changing any `VITE_*` env variables.

## Saved view operation failed

- Ensure your role and `view-logs` permission allow saved-view endpoints.
- For updates/deletes, select an existing saved view first.
- Absolute-mode saved views require valid start/end and start before end.

## Query works, but results are hard to read

- Use `Message view = Pretty (JSON-aware)` for structured JSON-style lines.
- Use `Expand details` for full row body and full label visibility.
- Use `Wrap: off` when scanning repeated prefixes in wide logs.
- Use `Copy line` for private clipboard handoff before posting room-visible evidence.

## `Show copy-ready sample` / `Share sample` does not respond

- Confirm app was re-uploaded after the latest build/package.
- Confirm the app is enabled and `/logs` opens the private contextual bar.
- Re-run `/logs` once to refresh interaction payload context, then retry buttons.
- If you clicked an old slash card after long delay/restart, snapshot context may expire; rerun `/logs`.
- Check Rocket.Chat app logs around click time for block-action handling entries (`executeBlockActionHandler` path).
- If app logs show `error-message-size-exceeded`, upgrade to a build with chat-size-aware copy/share truncation and retry.
- If still failing, collect:
  - workspace version
  - app version
  - timestamp
  - app logs around button click

## `Share elsewhere` validation errors

- `You do not have access to target room ...`:
  - ensure you are a member of the target room
  - if using room name, verify exact room display name/slug
- `Thread ... was not found in room ...`:
  - verify thread ID belongs to the target room
  - clear thread ID for room-timeline sharing
- `Share elsewhere request expired`:
  - rerun `/logs` to generate a fresh private slash card, then retry

## Many lines show level `[unknown]`

- This usually means your ingestion format does not provide a standard severity label.
- Current slash summary maps:
  - string levels: `error|warn|info|debug`
  - numeric levels (for example pino-style): `20->debug`, `30/35->info`, `40->warn`, `50+->error`
- If `[unknown]` remains high, inspect your log payload format and labels to confirm where level is stored.

## In-chat output is too small or too noisy

- Current behavior is intentional:
  - sidebar preview: up to 25 lines
  - preview can be lower when chat-size safety cap is hit
  - copy/share output: up to 40 lines (full-line-priority)
  - persisted slash snapshot: up to 80 lines for action reliability
- Use `search` and `level` filters to raise signal before sharing evidence.
- For deep analysis, switch to full viewer via **Open Logs Viewer**.

## Live polling stopped unexpectedly

- Polling only runs in relative mode; switching to absolute mode stops polling.
- Ensure polling interval is a positive number; values are clamped to `5..300` seconds.
- If query form validation fails during a polling tick, polling stops to avoid repeated errors.

## 8. Security and data handling

- Browser never receives Loki credentials.
- All queries go through app backend validation.
- Query access and denials are audit logged.
- Redaction can be enabled/disabled via settings; default is enabled.

## 9. Current limitations

- No server-push stream endpoint yet (UI polling mode is available)
- No export endpoint yet
