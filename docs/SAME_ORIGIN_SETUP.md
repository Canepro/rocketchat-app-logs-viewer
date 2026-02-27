# Same-Origin Web UI Setup

How to serve the Logs Viewer web UI at:

`https://<rocketchat-host>/logs-viewer/`

This is the recommended production default because browser requests to app APIs stay same-origin.

Last updated: 2026-02-27

## 1. Build artifacts

From repository root:

```bash
bun install
bun run build
```

Web static files are generated in:

`resources/web/`

## 1.1 Sync web assets to server path (helper script)

Use the helper script from repo root:

```bash
bun run deploy:web -- --target /srv/rocketchat/logs-viewer
```

Notes:

1. Default source is `resources/web/`.
2. By default, sync uses delete mode to remove stale files.
3. Add `--no-delete` if you want additive sync only.

## 2. Set app setting

In Rocket.Chat app settings:

```text
external_component_url=https://<rocketchat-host>/logs-viewer/
```

## 3. Serve `/logs-viewer/` from your web tier

You need your reverse proxy/web server to serve `resources/web/` at `/logs-viewer/`.

## 3.1 Nginx example

```nginx
location /logs-viewer/ {
    alias /srv/rocketchat/logs-viewer/;
    index index.html;
    try_files $uri $uri/ /logs-viewer/index.html;
}
```

Notes:

1. `alias` path must end with `/`.
2. Re-sync updated `resources/web/` files on each app release.

## 3.2 Caddy example

```caddyfile
handle_path /logs-viewer/* {
    root * /srv/rocketchat/logs-viewer
    try_files {path} /index.html
    file_server
}
```

## 4. Validation

After proxy update:

1. Open `https://<rocketchat-host>/logs-viewer/` directly in browser.
2. Confirm JS/CSS assets load (no 404 under `/logs-viewer/assets/...`).
3. In Rocket.Chat, run `/logs` and click **Open Logs Viewer**.
4. Confirm query calls hit `/api/apps/private/<appId>/...` on the same host.

## 5. Common failures

1. Blank page or broken styling:
   - static files not synced from `resources/web/`
   - wrong proxy root/alias path
2. 404 on refresh/deep link:
   - missing SPA fallback to `/logs-viewer/index.html`
3. CORS/auth errors:
   - UI is not actually same-origin; verify protocol, host, and port all match Rocket.Chat.
