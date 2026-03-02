# Logs Viewer Web (Same-Origin via GitOps)

Use this manifest set when deploying the Logs Viewer web UI at:

`https://<rocketchat-host>/logs-viewer/`

This avoids local filesystem sync and fits GitOps workflows.

## 1. Public-first quickstart (recommended)

Use the published image that is released from this repository:

- image repository: `ghcr.io/canepro/rocketchat-app-logs-viewer-web`
- default manifest tag: `v0.1.3`

Update only these environment values before apply:

1. `ingress.yaml` host/TLS host (`rocketchat.example.com` -> your domain)
2. `ingressClassName` (if your cluster is not `traefik`)
3. TLS secret name (if your cluster uses a different secret)

Then apply through GitOps:

```bash
kubectl apply -k deploy/k8s/logs-viewer-web
```

## 2. Set Rocket.Chat app setting

Set:

```text
external_component_url=https://<rocketchat-host>/logs-viewer/
```

## 3. Validation

1. Open `https://<rocketchat-host>/logs-viewer/`
2. Confirm assets load under `/logs-viewer/assets/...`
3. Confirm `/logs-viewer` redirects to `/logs-viewer/`
4. Run `/logs` and click **Open Logs Viewer**

## 4. Maintainer/contributor image release flow

Use this only when cutting a new image version:

1. Update versions/changelog (`app.json`, `CHANGELOG.md`, `docs/VERSION_TRACKER.md`)
2. Tag release commit (`git tag vX.Y.Z && git push origin vX.Y.Z`)
3. GitHub Actions publishes GHCR image via `.github/workflows/web-image-release.yml`
4. Update `deployment.yaml` image tag to `vX.Y.Z` in the same release change set
