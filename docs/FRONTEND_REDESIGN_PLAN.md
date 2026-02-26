# Frontend Redesign Plan – Logs Viewer

This document is a **plan** to make the Logs Viewer External Component UI more professional and visually polished while staying within the existing stack and scope. It is informed by the current implementation, stack docs, design doc, and execution plan.

**Last updated:** 2026-02-26

### Implementation status

| Phase | Status | Notes |
|-------|--------|------|
| **A – Theme** | Done | Theme toggle in header; `initTheme()` in main.tsx; `--log-surface-*` tokens and `.log-surface` class; dark mode applied via `class="dark"`. |
| **B – Layout** | Done | AppShell (header + sidebar + main); all controls in left sidebar (From /logs, Query, Audit, Saved views, Targets); main area = config error or log list + toolbar. See `web/docs/ARCHITECTURE.md`. |
| **B – Responsive** | Done | Sidebar is a drawer on viewports &lt; 768px: Filters button in header opens overlay; close via X or click outside. `useMediaQuery(SIDEBAR_INLINE_BREAKPOINT)`, AppShell `isDrawerMode` / `sidebarOpen` / `onSidebarOpenChange`. |
| **C – Components** | Done (v0.1 scope) | Query form grouped into Time/Filters/Options; per-row actions consolidated into one dropdown. Native `<select>` intentionally retained for this release train; Radix Select is tracked as a follow-up. |
| **D – Results UX** | Done (v0.1 scope) | Compact toolbar (message view, wrap toggle, collapse all, row/expanded counters), metadata tooltip + level `aria-label`, and skeleton list states for audit/saved-view/target panes. |
| **E – A11y & embed** | Done (engineering) | `h1/h2` heading structure, query region labeling, wrap `aria-pressed`, collapse button label, level badge labels, and RC embed checklist added. Manual embed sign-off remains an operator execution task. |

---

## 1. Context and constraints

### 1.1 Stack (do not change)

| Layer | Current choice | Reference |
|-------|----------------|-----------|
| **Runtime** | React 19 + Vite 7 | `web/package.json`, `docs/STACK.md` |
| **Styling** | Tailwind CSS; shadcn-style primitives (Radix, CVA, clsx, tailwind-merge); Lucide icons | `docs/STACK.md`, `web/components.json` |
| **Data** | TanStack Query (server state), TanStack Virtual (log list) | `web/src/App.tsx`, `web/src/lib/api.ts` |
| **Build** | Output to `resources/web/` for app consumption | `web/vite.config.ts` |
| **Embedding** | Rocket.Chat External Component (contextual bar or modal) | `README.md`, `DESIGN.md` |

**Preferences:** Bun for all tooling (no npm); shadcn/ui for UI components. See `docs/STACK.md`.

Theme and contrast must work when embedded in Rocket.Chat. DESIGN.md §4.3 calls out **dark/light theme** (system or RC) as nice-to-have for long sessions.

### 1.2 In scope for redesign

- **Layout, visual design, component structure** of `web/src/`.
- **Accessibility, readability, consistency** of empty/loading/error states (aligned with Phase 2 in `docs/EXECUTION_PLAN.md`).
- **Theme** compatible with embedding (light/dark as enhancement).
- **Preserve behavior**: query form, saved views, targets/threads pickers, row actions, polling, virtualized list, expand/copy/wrap/pretty-raw controls. Redesign improves **how** they look and are organized, not **what** they do.

### 1.3 Out of scope

- Backend, app API, slash command, or new product features.

---

## 2. Current state summary

### 2.1 Already improved

- Enterprise shell: subtle gradient backdrop, bordered header, section cards.
- Visual language refinement: non-generic observability palette (teal/cyan glow over deep surfaces) and clearer primary contrast.
- Results: high-contrast monospace log surface, level-accented row rails, alternating row tones, truncated label chips with tooltips, 640px virtualized viewport.
- UX: slash-context card with visible IDs, config error details, alert semantics, theme-aware select caret.
- Sidebar readability: widened shell (`368px` inline, `min(380px, 100vw)` drawer) and removed viewport-only 3-column form grids from sidebar panels.

### 2.2 Follow-up backlog (post-v0.1 frontend)

- Radix Select migration for stronger keyboard/accessibility consistency.
- Optional tabs/collapsible groups for Saved views and Audit panes.
- Optional segmented controls for message view / wrap toggles.
- Expanded visual language pass (typography and spacing) after functional freeze.
- Optional RC-host theme contract (if Rocket.Chat exposes stable theme signal for external components).

---

## 3. Layout philosophy: logs-first with sidebar controls

**Recommendation:** Make the **log stream the primary content** and put **all controls in a sidebar** (or equivalent). This is the standard, professional pattern for log/observability UIs.

### Why this works

- **Task alignment:** Operators open the viewer to **scan and act on logs**. The main pane should be logs; query params, saved views, audit, and room/thread targets are **supporting controls**.
- **Industry pattern:** Grafana (query in sidebar/panel, results central), Datadog Logs, CloudWatch Logs, and similar tools use “filters/query on the side, logs in the main area.” Users expect it.
- **Rocket.Chat context:** The app is often opened from “Open Logs Viewer” for deeper inspection; putting logs front-and-center matches that intent and reduces scrolling past forms to see results.
- **Embedding:** In a contextual bar or modal, a narrow sidebar + main content area uses width well; the log viewport can flex to fill remaining space.

### Recommended layout

- **Main area (default focus):** Log results only — virtualized list, toolbar (message view, wrap, collapse, counts), row actions. Optional: slim bar above logs for “Run query” + live status (e.g. “Live 15s” / “Off”) so one primary action is always visible without opening the sidebar.
- **Sidebar:** All controls in one collapsible or fixed sidebar (e.g. left):
  - **Query:** Time mode, since/start–end, limit, level, search, polling interval, Run / Start polling / Stop polling.
  - **Saved views:** Name, Save as new, Update/Delete selected, list of views + Apply.
  - **Audit:** User ID, outcome, limit, Refresh, audit list.
  - **Targets:** Room target (search, list, room ID), thread (search, list, thread ID), Use slash room/thread target, Clear.
  - **From /logs** context (when present): room/thread/sender badges.
- **Header:** App title, theme toggle, optional compact status (preset, autorun, source). Keep minimal so the main area feels like “the app.”
- **Responsive:** On narrow viewports, sidebar can become a drawer (overlay) or top/bottom accordion so logs remain the first thing in the document and on screen.

This replaces the current “stack of cards” with a **single clear split:** sidebar = configuration, main = output. Phase B below is updated to implement this as the preferred layout.

---

## 4. Redesign plan (phased)

### Phase A – Theme and tokens

**Goal:** Support light/dark cleanly and prepare for RC embedding.

1. **Theme detection and toggle**
   - Prefer `prefers-color-scheme` and optional RC host message for theme; fallback to stored preference.
   - Add a small theme toggle in the header (e.g. sun/moon icon) that sets `class="dark"` on `document.documentElement` and persists to `localStorage`.
   - Ensure all semantic tokens (`--background`, `--foreground`, `--card`, `--muted`, `--border`, etc.) look good in both themes; adjust log content panel (currently hardcoded slate-950/slate-100) to use theme-aware tokens or dedicated log-surface tokens.

2. **Log surface tokens**
   - Introduce tokens for the log message area (e.g. `--log-surface-bg`, `--log-surface-fg`) so the high-contrast monospace block respects light/dark without hardcoded slate colors.

3. **Document**
   - Maintain theme behavior notes in this plan and `web/docs/ARCHITECTURE.md`.

**Deliverables:** Theme toggle in header; dark mode fully usable; log panel theme-aware; no new dependencies.

---

### Phase B – Layout: sidebar + logs-first main area

**Goal:** Implement the layout described in §3 — controls in sidebar, logs as primary content.

1. **Structure**
   - **Main area:** Log results only (virtualized list, toolbar, row actions). No cards stacking above the list; logs are the first meaningful content after a minimal header.
   - **Sidebar (left):** Single panel containing, in order: From /logs context (if any) → Query (time, limit, level, search, polling, Run / Start / Stop) → Saved views → Audit → Targets (room/thread). Use internal collapsible sections or tabs within the sidebar so users can expand “Query”, “Saved views”, etc. as needed.
   - **Header:** Title “Logs Viewer”, theme toggle, compact status (e.g. Live 15s / Off, preset, autorun). Optional: “Run query” in header or above main area so the primary action is one click away without opening sidebar. Move “App ID / API base” and default range / max lines into sidebar footer or “About”/tooltip.

2. **Sidebar behavior**
   - **Desktop:** Fixed or resizable sidebar (e.g. 280–360px); main area takes remaining width. Consider a collapse/expand toggle (icon-only) so power users can maximize log width.
   - **Narrow (e.g. contextual bar):** Sidebar becomes a drawer (overlay) or bottom sheet; “Filters” or “Settings” button opens it. Default view still shows logs first; opening sidebar is explicit.

3. **Visual hierarchy**
   - Sidebar: subtle background (e.g. `bg-muted/30` or `border-r`), section headings, compact forms. No need for heavy cards; light dividers and spacing are enough.
   - Main: log viewport dominates; toolbar (message view, wrap, collapse, counts) stays minimal above the list.

4. **Copy and density**
   - Shorten labels and descriptions inside the sidebar; move long explanations to tooltips or “Help” so the main area stays about logs.

**Deliverables:** Sidebar containing all controls; main area only logs + toolbar; responsive drawer on narrow viewports; header minimal; logs are the clear focus of the app.

---

### Phase C – Component and form polish

**Goal:** More professional-looking controls and consistency.

1. **Shadcn components**
   - Add or align with shadcn/ui New York style: ensure `Select` uses Radix Select (not native `<select>`) for consistent styling and keyboard support; add `Tabs` if we adopt a tabbed layout for Audit/Saved views; consider `DropdownMenu` for “…” actions or saved-view quick apply.
   - Keep `components.json` and existing CVA patterns; add only needed components via `bunx shadcn@latest add <component>`.

2. **Form layout**
   - Query form: group “Time”, “Filters” (level, search), “Options” (limit, polling) with optional sub-labels or dividers; align label/input grid (e.g. consistent `space-y-1.5` and column spans).
   - Audit and Saved views: same grid/label consistency; consider a single “Saved view” dropdown to load presets and a separate “Save current” flow to reduce button row length.

3. **Buttons**
   - Primary: one clear primary per card (e.g. “Run query”, “Save as new”).
   - Secondary/outline: use consistently for “Refresh”, “Apply”, “Clear”; reduce size (e.g. `size="sm"`) where it fits.
   - Row actions: consider icon-only or icon+text in a single `DropdownMenu` per row (“Copy”, “Share to room”, “Incident draft”, “Thread note”) to cut repetition and width; keep keyboard and screen-reader labels.

4. **Inputs and selects**
   - Ensure focus ring and border use design tokens; optional subtle shadow on focus for inputs.
   - Error state: red border + short message under field; keep existing `formError` and inline alerts.

**Deliverables:** Radix-based Select (or equivalent) where it matters; consistent form spacing; row actions in dropdown or compact group; polished focus/error states.

---

### Phase D – Query results and log row UX

**Goal:** Faster scan and less clutter without losing capability.

1. **Toolbar (message view, wrap, collapse, counts)**
   - Single compact toolbar row: [Message: Pretty | Raw] [Wrap: On | Off] [Collapse all] [rows / expanded counts].
   - Use small buttons or segmented control for Pretty/Raw and Wrap; keep “Collapse all” and badges compact.

2. **Log row layout**
   - Keep: level rail, timestamp, level badge, monospace message block, labels, row actions.
   - Optional: collapse metadata (chars, lines, format, preview) into a single “Details” or tooltip to shorten the first line; or show a single “Meta” badge that expands on click.
   - Row actions: see Phase C (dropdown or icon strip) to reduce horizontal space.

3. **Empty and loading**
   - EmptyState: optional illustration or stronger icon; keep title + description + optional CTA.
   - LoadingState: consider skeleton for audit list and saved-views list instead of only spinner+text for consistency with Phase 2.

**Deliverables:** Compact toolbar; optional metadata collapse; row actions grouped; improved empty/loading where applicable.

---

### Phase E – Accessibility and embedding

**Goal:** WCAG-friendly and safe inside Rocket.Chat.

1. **Accessibility**
   - Ensure focus order follows visual order; all interactive elements focusable and visible focus ring.
   - Card/section titles as headings (e.g. `h2`) with a single `h1` for “Logs Viewer”; aria-labels where needed for icon-only buttons.
   - Color: ensure level rails and badges are distinguishable by more than color (e.g. text “error”/“warn” + icon); contrast ratios meet AA for text and UI.

2. **Embedding**
   - Test in RC contextual bar and modal; respect container width (no fixed min-width that breaks layout).
   - If RC exposes theme (e.g. via postMessage or URL), consume it in Phase A instead of or in addition to system preference.

**Deliverables:** Focus order and ARIA checked; AA contrast; tested in RC embed.

---

## 5. Implementation order and dependencies

| Phase | Depends on | Suggested order |
|-------|------------|-----------------|
| A – Theme | None | 1 |
| B – Layout | None | 2 |
| C – Components | B (layout can influence form grouping) | 3 |
| D – Results UX | C (row actions dropdown) | 4 |
| E – A11y & embed | A, B, C, D | 5 |

Phases can be split into smaller PRs (e.g. A1: theme toggle, A2: log-surface tokens).

---

## 6. References

- **Stack and scope:** `docs/STACK.md`, `README.md`
- **Design and product:** `DESIGN.md` (§4.2, §4.3 for UI/theme)
- **Execution and quality:** `docs/EXECUTION_PLAN.md` (Phase 2 web UI)
- **Implementation map:** `docs/IMPLEMENTATION.md` (frontend section)
- **API contract:** `docs/API_CONTRACT.md` (no frontend contract change)

---

## 7. Definition of done (per phase)

- No backend or API changes.
- `bun run build` and `bun run typecheck` pass.
- Existing behavior preserved (query, audit, views, targets, threads, row actions, polling, virtualization).
- Theme (if implemented) works in standalone and, where possible, in RC embed.
- Redesign alignment doc updated if scope or outcomes change.
