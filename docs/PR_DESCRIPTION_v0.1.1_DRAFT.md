# PR Description Draft: v0.1.1 Candidate

## Title

`feat(logs-viewer): in-chat reliability hardening + web readability controls`

## Summary

This PR advances `v0.1.1` by hardening Rocket.Chat-native `/logs` workflows and improving web query-result readability without changing core API contracts.

## Why

1. Improve reliability of in-chat `Copy sample` / `Share sample` actions under real payload sizes.
2. Improve operator speed when triaging large JSON-heavy log lines.
3. Reduce noisy client probe behavior during local/private app API usage.

## Changes

### Backend / app behavior

1. Snapshot-backed slash sample actions with compact payload references.
2. Snapshot TTL enforcement at read time (stale snapshot protection).
3. Chat-size safety cap for slash quick-summary sample preview.
4. Improved copy/share messaging with displayed/total line counts.

### Web UI

1. Results controls:
   - pretty/raw message mode
   - wrap on/off
   - row expand/collapse
   - row copy line
2. Row metadata chips (`chars`, `lines`, format, preview marker).
3. Virtual row measurement for dynamic heights.
4. Private-first app API candidate probing with public fallback on `404`.

### Documentation and governance

1. Added [SMOKE_CHECKLIST_4PM.md](./SMOKE_CHECKLIST_4PM.md) with pre-filled execution metadata.
2. Added [RELEASE_NOTES_v0.1.1_DRAFT.md](./RELEASE_NOTES_v0.1.1_DRAFT.md).
3. Updated plan/implementation/runbook/user/version/drift/handoff/changelog docs.

## Security / RBAC Impact

1. No relaxation of role or workspace permission checks.
2. Share/denied audit behavior retained and extended with clearer action context.
3. No secret material introduced to repository.

## Test Evidence

Local validation commands:

1. `bun run test` (pass)
2. `bun run typecheck` (pass)
3. `bun run build` (pass)
4. `bun run package` (pass)

## Live Validation Plan

Use [SMOKE_CHECKLIST_4PM.md](./SMOKE_CHECKLIST_4PM.md) and store artifacts under:

`evidence/2026-02-26-v0.1.1-smoke/`

## Rollback

1. Disable app or reinstall previous known-good package.
2. Revert app settings changed for validation.
3. Record rollback evidence in runbook/release notes.

## Follow-ups (not in this PR)

1. Stream endpoint spike (design + threat model only).
2. Export endpoint.
3. Marketplace submission packet finalization.
