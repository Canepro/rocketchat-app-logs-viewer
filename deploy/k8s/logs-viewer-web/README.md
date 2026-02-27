# Logs Viewer Web (Same-Origin via GitOps)

Use this manifest set when deploying the Logs Viewer web UI at:

`https://<rocketchat-host>/logs-viewer/`

This avoids local filesystem sync and fits GitOps workflows.

## 1. Build and publish web image

Build/push an image from `web/Dockerfile.same-origin`:

```bash
docker build -f web/Dockerfile.same-origin -t ghcr.io/canepro/rocketchat-app-logs-viewer-web:<tag> .
docker push ghcr.io/canepro/rocketchat-app-logs-viewer-web:<tag>
```

Then update `deployment.yaml` image tag to your released tag.

## 2. Apply through GitOps

Commit the `deploy/k8s/logs-viewer-web/` manifests into your GitOps repo and let ArgoCD/Flux reconcile them.

Current defaults target:

- namespace: `rocketchat`
- host: `k8.canepro.me`
- ingress class: `traefik`
- TLS secret: `rocketchat-tls`

Adjust these for other environments.

## 3. Set Rocket.Chat app setting

Set:

```text
external_component_url=https://k8.canepro.me/logs-viewer/
```

## 4. Validation

1. Open `https://k8.canepro.me/logs-viewer/`
2. Confirm assets load under `/logs-viewer/assets/...`
3. Run `/logs` and click **Open Logs Viewer**
