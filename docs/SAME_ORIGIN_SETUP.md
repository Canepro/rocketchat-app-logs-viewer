# Same-Origin Web UI Setup

Serve the Logs Viewer UI at:

`https://<rocketchat-host>/logs-viewer/`

This is an optional advanced mode. Use it when you control ingress/proxy routing and want same-origin app API behavior.

Last updated: 2026-02-27

## 1. Pick deployment mode

## 1.1 GitOps/Kubernetes mode (recommended for GitOps environments)

Use image + manifests (no local `/srv` sync):

1. Build/push image from `web/Dockerfile.same-origin`
2. Commit/apply manifests under `deploy/k8s/logs-viewer-web/` via your GitOps repo
3. Set app setting:

```text
external_component_url=https://k8.canepro.me/logs-viewer/
```

Reference:

- `deploy/k8s/logs-viewer-web/README.md`

## 1.2 VM/filesystem mode (manual sync)

Use this only if your reverse proxy serves local filesystem paths directly:

```bash
bun run build
bun run deploy:web -- --target /srv/rocketchat/logs-viewer
```

Then configure your reverse proxy to serve `/logs-viewer/` from that directory.

## 2. Validation

1. Open `https://<rocketchat-host>/logs-viewer/`
2. Confirm assets load from `/logs-viewer/assets/...` (no 404s)
3. In Rocket.Chat, run `/logs` and click **Open Logs Viewer**
4. Confirm config loads (no `HTTP 401` banner in the viewer)

## 2.1 Authentication behavior (same-origin)

- The web UI calls Rocket.Chat app API endpoints and needs Rocket.Chat auth context.
- In same-origin mode, the UI now auto-detects auth from browser storage (current Rocket.Chat session) and sends request headers.
- If browser storage auth is unavailable (for example: no active workspace session in that browser profile), calls return `401`.
- Fallback option:
  - configure explicit token mode for the web UI (`VITE_ROCKETCHAT_USER_ID`, `VITE_ROCKETCHAT_AUTH_TOKEN`) in environments where session storage is not available to the page.

## 2.2 UI behavior defaults

- Desktop deep links from `/logs` (`source=slash`) open with filters hidden by default, so logs use more horizontal space.
- Operators can toggle filters from the header (`Show filters` / `Hide filters`).
- The viewer remembers display preferences (filters visibility, message view mode, wrap mode) in browser local storage.

## 3. Common failures

1. `404 Page not found` on `/logs-viewer/`:
   - ingress/proxy route for `/logs-viewer` is missing
2. Blank page or missing CSS/JS:
   - UI assets are not served at `/logs-viewer/assets/...`
3. `Config unavailable: Request failed (401)`:
   - user session/auth context is missing in that browser profile
   - open viewer from an active Rocket.Chat session on the same origin, or use token mode
4. Works locally but not on cluster:
   - local `/srv/...` sync is not visible to Kubernetes ingress unless mounted into a cluster-served pod/service
