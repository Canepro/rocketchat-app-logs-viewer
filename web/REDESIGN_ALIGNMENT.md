# Frontend redesign – alignment

This branch (`feature/frontend-redesign`) is for **frontend-only** redesign of the Logs Viewer External Component. Use this doc to keep the redesign aligned with the repo stack and plan.

## Stack (do not change)

- **Runtime:** React 19 + Vite 7, built into `resources/web/` (consumed by the app).
- **Styling:** Tailwind CSS; UI primitives are shadcn-style (Radix, CVA, clsx, tailwind-merge). Lucide icons.
- **Data:** TanStack Query for server state; TanStack Virtual for log list. API client in `src/lib/api.ts` – same endpoints and contract as today.
- **Embedding:** UI runs inside Rocket.Chat External Component (contextual bar or modal). Theme/contrast should work when embedded in RC.

See root `docs/STACK.md` and `README.md` for full stack and app architecture.

## Out of scope for this branch

- **Backend / app API:** No changes to `main.ts`, `src/api/*`, app settings, or API contract. Redesign does not add or remove endpoints or request/response shapes.
- **Slash command / in-chat:** No changes to `/logs` command, slash-card actions, or contextual bar opening behavior; only the **web UI** loaded in that bar is in scope.
- **New product features:** No new workflows (e.g. stream, export) in this branch; redesign is visual/UX and structure only.

## In scope

- Layout, visual design, and component structure of the web app (`web/src/`).
- Accessibility, readability, and consistency of empty/loading/error states (aligned with Phase 2 in `docs/EXECUTION_PLAN.md`).
- Theme and tokens compatible with Rocket.Chat embedding (design calls out dark/light as nice-to-have in `DESIGN.md` §4.3).
- Preserve existing behavior: query form, saved views, targets/threads pickers, row actions, polling, virtualized list, expand/copy/wrap/pretty-raw controls. Redesign improves how they look and are organized, not what they do.

## References

- **Design & product:** Root `DESIGN.md` (positioning, features, guardrails).
- **Execution plan:** `docs/EXECUTION_PLAN.md` (phases, quality gates, Phase 2 web UI scope).
- **Implementation map:** `docs/IMPLEMENTATION.md` (code map, API behavior).
- **API contract:** `docs/API_CONTRACT.md` (endpoints, auth, request/response).
- **Handoff / next work:** `docs/HANDOFF.md`.
