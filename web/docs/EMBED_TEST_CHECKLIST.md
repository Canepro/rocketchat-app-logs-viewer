# Embed test checklist (Phase E)

Use this checklist when verifying the Logs Viewer External Component inside Rocket.Chat (contextual bar or modal). Ensures layout, theme, and accessibility hold up in the embed.

**See also:** `docs/FRONTEND_REDESIGN_PLAN.md` Phase E, `docs/RUNBOOK.md`.

---

## 1. Layout and responsiveness

- [ ] **Contextual bar:** Open the app in a narrow contextual bar. Main area shows logs (or empty state) first; no horizontal scroll on the viewport.
- [ ] **Filters button:** On narrow width (&lt; 768px), header shows a **Filters** button. Clicking it opens the sidebar as an overlay (drawer) from the left.
- [ ] **Drawer close:** Close via the X button or by clicking the backdrop. Main content remains visible behind.
- [ ] **Desktop width:** At 768px or wider, sidebar is inline (no Filters button); layout matches standalone.
- [ ] **No fixed min-width:** The app does not force a minimum width that would break the embed; content reflows.

---

## 2. Theme

- [ ] **Light/dark toggle:** Header theme toggle (sun/moon) switches between light and dark. Preference persists after reload (`localStorage` key `logs-viewer-theme`).
- [ ] **System preference:** If no stored preference, initial theme follows `prefers-color-scheme` (after first load).
- [ ] **Log surface:** The monospace log message block uses theme-aware tokens (readable in both themes); no hardcoded light/dark colors.
- [ ] **RC host theme (future):** If Rocket.Chat later exposes theme via postMessage or URL param, document the contract here and consume in `theme.ts`.

---

## 3. Accessibility (quick pass)

- [ ] **Focus order:** Tab through the page; focus order follows visual order (header → sidebar or Filters → main).
- [ ] **Focus visible:** Focus ring is visible on all interactive elements (buttons, inputs, selects, dropdown triggers).
- [ ] **Single h1:** Only “Logs Viewer” is an `h1`; section titles use `h2` or appropriate heading level.
- [ ] **Icon-only buttons:** Theme toggle and drawer close (X) have `aria-label`. Filters button has “Open filters and controls”.
- [ ] **Level badges:** Level is conveyed by text (“error”, “warn”, etc.) and not by color alone; sufficient contrast for AA.

---

## 4. Functional smoke

- [ ] **Config load:** If app is configured, config loads and query form is enabled.
- [ ] **Run query:** Run query returns results (or empty) and virtualized list renders.
- [ ] **Row actions:** Actions dropdown opens; Copy, Share to room, and other actions work when targets are set.
- [ ] **Drawer + query:** With drawer open, run query and close drawer; results appear in main area.

---

## Sign-off

| Date       | Tester | Context (e.g. RC version, bar vs modal) | Pass/fail |
|------------|--------|------------------------------------------|-----------|
| _optional_ |        |                                          |           |

Record any layout or theme issues and fix in the next iteration.
