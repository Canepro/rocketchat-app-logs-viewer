# Release Notes Draft: v0.1.1

Status: Draft (not released)  
Last updated: 2026-02-26

## 1. Release intent

`v0.1.1` is a hardening release focused on Rocket.Chat-native usability, action reliability, and operator clarity.

## 2. Highlights

1. In-chat slash workflow reliability:
   - per-user snapshot-backed slash sample actions
   - compact button payload references (instead of large inline payloads)
   - stale snapshot fail-safe response (`run /logs again`)
2. In-chat output quality:
   - numbered quick-summary sample preview
   - clearer sampled-line count/truncation messaging
   - chat-size preview safety cap
3. Web results usability:
   - pretty/raw message rendering
   - wrap on/off toggle
   - per-row expand/collapse
   - per-row copy line
   - row metadata chips (`chars`, `lines`, format, preview marker)
4. Client probe behavior:
   - private-first app API base candidate resolution with public fallback on `404`

## 3. Why this release matters

This release improves the primary product promise: fast, in-context incident triage inside Rocket.Chat while still leveraging Loki as backend source of truth.

## 4. Scope boundaries

Not included in `v0.1.1`:

1. Stream endpoint (SSE/WebSocket)
2. Export endpoint
3. Marketplace submission packet finalization

## 5. Acceptance criteria

## Functional

1. `/logs` remains private-only to invoking user.
2. `Copy sample` and `Share sample` work for allowed operators.
3. Stale slash snapshot returns explicit rerun guidance.
4. Web results controls (pretty/raw, wrap, expand/collapse, copy line) function without layout breakage.
5. API probe sequence is private-first in browser client.

## Security and governance

1. RBAC/role gating remains enforced.
2. Share action remains audit logged (allowed + denied paths).
3. No secret values introduced in repo/docs.

## Quality gates

1. `bun run test` passes.
2. `bun run typecheck` passes.
3. `bun run build` passes.
4. `bun run package` passes.
5. Live smoke checklist passes after cluster start (`docs/SMOKE_CHECKLIST_4PM.md`).

## 6. Rollback

1. Disable app or reinstall previous known-good package.
2. Revert settings changes if behavior regression is configuration-coupled.
3. Document rollback evidence in runbook/release record.
