# Web app architecture

This document describes the structure, layout, and conventions of the Logs Viewer External Component (the `web/` Vite app). It is the single source of truth for frontend architecture.

**See also:** root `docs/STACK.md` (stack preferences), `docs/FRONTEND_REDESIGN_PLAN.md` (frontend status and roadmap).

---

## 1. Layout: logs-first with sidebar controls

The UI is split into two main areas:

| Area | Purpose | Contents |
|------|--------|----------|
| **Header** | App identity and global actions | Title "Logs Viewer", theme toggle, compact status (Live/Off, preset, autorun). Optional: primary "Run query" for one-click run without opening sidebar. |
| **Sidebar** | All configuration and controls | From /logs context → Query form (time, limit, level, search, polling, Run/Start/Stop) → Saved views → Audit → Targets (room/thread). Sections can be collapsible. |
| **Main** | Primary content | Log results only: virtualized list, toolbar (message view, wrap, collapse, counts), row actions. No cards above the list; logs are the first meaningful content. |

**Rationale:** Operators open the viewer to scan and act on logs. The main pane is the log stream; the sidebar holds supporting controls. This matches patterns used by Grafana, Datadog Logs, and CloudWatch.

**Responsive:** On viewports &lt; 768px (and when embedded in a narrow Rocket.Chat contextual bar), the sidebar is a **drawer**: hidden by default, opened via the **Filters** button in the header. The drawer overlays the main area, has a close (X) button and click-outside-to-close. Above 768px the sidebar is inline (always visible). Current widths are tuned for readability: `368px` inline and `min(380px, 100vw)` in drawer mode. See `useMediaQuery(SIDEBAR_INLINE_BREAKPOINT)` and `AppShell` props `isDrawerMode`, `sidebarOpen`, `onSidebarOpenChange`.

---

## 2. Theme

- **Light / dark:** Controlled by CSS class `dark` on `document.documentElement`. Theme is resolved in this order: user toggle (persisted in `localStorage` key `logs-viewer-theme`) → `prefers-color-scheme` → default light.
- **Tokens:** All colors use CSS custom properties in `src/index.css` (`:root` and `.dark`). Semantic tokens: `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, etc. Log message surface uses `--log-surface-bg` and `--log-surface-fg` so the monospace block respects light/dark without hardcoded colors.
- **Visual direction:** The shell uses an observability-style cyan/blue glow surface (`.app-shell-surface`) to avoid generic flat-dark styling and keep primary actions distinct from content regions.
- **Embedding:** When run inside Rocket.Chat, theme can later be driven by host message or URL param; for now we respect system and user toggle.

---

## 3. Data flow

- **Server state:** TanStack Query (`@tanstack/react-query`) for all app API calls. Keys: `logs-config`, `logs-audit`, `logs-targets`, `logs-views`, `logs-threads`. Mutations: `queryLogs`, `mutateSavedView`, `postLogAction`.
- **API client:** `src/lib/api.ts` – typed functions for `/config`, `/query`, `/audit`, `/targets`, `/threads`, `/views`, `/actions`. Handles auth, API path resolution (private/public fallback), and error normalization.
- **Local state:** Form fields, UI toggles (sidebar open, expanded rows, message view mode, wrap), and prefill from URL are in React state in `App.tsx`. No global client state store; context is used only for theme if needed.

---

## 4. File map

| Path | Role |
|------|------|
| `src/main.tsx` | Entry: QueryClientProvider, theme init, renders `App`. |
| `src/App.tsx` | Root component: layout (header, sidebar, main), all query/audit/views/targets state, log mutation and virtualized list. |
| `src/index.css` | Tailwind directives, CSS variables (theme + log surface), global styles (body, .font-mono-log, .log-scrollbar). |
| `src/lib/api.ts` | App API client. |
| `src/lib/utils.ts` | `cn()` and shared helpers. |
| `src/lib/polling.ts` | Polling interval parsing and constants. |
| `src/components/EmptyState.tsx` | Empty state placeholder (icon, title, description). |
| `src/components/ErrorState.tsx` | Error alert (title, message, optional details). |
| `src/components/LoadingState.tsx` | Loading spinner + message. |
| `src/components/ui/*` | shadcn-style primitives: alert, badge, button, card, dropdown-menu, input, label, select. |
| `src/components/layout/*` | AppShell, ThemeToggle (layout and theme). |

---

## 5. Core component map

| Component | Path | Purpose |
|-----------|------|---------|
| `AppShell` | `src/components/layout/AppShell.tsx` | Header + sidebar + main shell. Handles inline sidebar vs overlay drawer mode. |
| `ThemeToggle` | `src/components/layout/ThemeToggle.tsx` | Light/dark toggle backed by `src/lib/theme.ts`. |
| `EmptyState` | `src/components/EmptyState.tsx` | Consistent empty-state panel for lists and result sections. |
| `ErrorState` | `src/components/ErrorState.tsx` | Standard destructive alert wrapper with optional backend details text. |
| `LoadingState` | `src/components/LoadingState.tsx` | Inline spinner for lightweight loading feedback. |
| `SkeletonRows` | `src/components/SkeletonRows.tsx` | Dense row skeletons for list panes while data is pending. |
| `DropdownMenu` | `src/components/ui/dropdown-menu.tsx` | Radix dropdown primitive used by per-row Actions menu. |

---

## 6. Conventions

- **Stack:** Bun for tooling (no npm). shadcn/ui for new UI components; add via `bunx shadcn@latest add <component>`.
- **Styling:** Tailwind only; use semantic tokens (e.g. `bg-background`, `text-muted-foreground`) so theme stays consistent.
- **Log content:** Use `.font-mono-log` and log-surface tokens for the virtualized log message block so readability and theme are consistent.
- **Accessibility:** One `h1` per view ("Logs Viewer"); section titles as `h2`/`h3`. Focus order follows layout; icon-only buttons have `aria-label`. Alerts use `role="alert"` and `aria-live` where appropriate.
- **Documentation:** Update this file and root `docs/FRONTEND_REDESIGN_PLAN.md` in the same change-set whenever frontend scope/status changes. **Embed test:** Use `web/docs/EMBED_TEST_CHECKLIST.md` when verifying the app in Rocket.Chat (Phase E).
