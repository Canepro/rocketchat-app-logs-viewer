# Smoke Checklist

Operational run-sheet for live validation of a packaged release.

Last updated: 2026-02-26

## Data handling policy

This checklist references evidence filenames for operator consistency, but raw runtime artifacts are sensitive and should not be committed to git.

- Store HAR files, workspace screenshots, raw logs, and unredacted notes in private storage.
- Keep only sanitized summaries/templates in this repository.
- Follow `evidence/README.md` before publishing the repository.

## 1. Goal

Validate release behavior end-to-end in a live Rocket.Chat workspace.

## 2. Preconditions

1. Cluster and workspace are healthy.
2. App is enabled with current package (`logs-viewer_<version>.zip`).
3. Non-secret settings are confirmed:
   - `logs_source_mode`
   - `required_label_selector`
   - `allowed_roles`
   - `workspace_permission_mode`
   - `workspace_permission_code`
4. Test users available:
   - one allowed operator
   - one denied user

## 2.1 Run metadata (fill per execution)

| Field | Value |
|------|-------|
| Date | `YYYY-MM-DD` |
| Planned start | `HH:MM local` |
| Actual start | `HH:MM local` |
| Branch | `main` |
| Artifact | `dist/logs-viewer_<version>.zip` |
| Artifact SHA256 | `TBD` |
| Evidence root (private storage) | `<private-path>/<date>-v<version>-smoke/` |
| Allowed user | `TBD` |
| Denied user | `TBD` |
| Target room | `TBD` |
| Target thread | `TBD` |
| Workspace URL | `TBD` |
| Workspace version (`/api/info`) | `TBD` |

## 3. Scenarios

## 3.1 `/logs` privacy + open path

1. As allowed user, run `/logs since=15m limit=200`.
2. Confirm private contextual bar opens (no room-visible command output).
3. Confirm header text includes private visibility notice.

Expected:
- Private-only response.
- Open button works.
- No room broadcast of slash response.

## 3.2 In-chat summary quality

1. Confirm quick summary shows:
   - source
   - window
   - sample lines count
   - top levels/signals
2. Confirm sample preview is numbered.
3. Confirm preview remains stable (no block-size failure).

Expected:
- Preview is readable.
- If capped, summary explicitly mentions chat-size cap.

## 3.3 Slash card actions

1. Click `Show copy-ready sample`.
2. Confirm private copy-ready block is returned.
3. Click `Share sample`.
4. Confirm room/thread post succeeds.
5. Click `Share elsewhere`.
6. In modal, set target room (ID or name), optional thread ID, and submit.
7. Confirm target room/thread post succeeds.
8. Confirm audit contains corresponding action.

Expected:
- Copy is private.
- Share is room/thread-visible and audited.
- Share elsewhere is target room/thread-visible (membership-validated) and audited.
- Success message includes displayed/total line counts.

## 3.4 Stale snapshot behavior

1. Run `/logs`.
2. Wait enough time or use old card from prior run.
3. Click `Show copy-ready sample` on stale card.

Expected:
- User gets fail-safe message to rerun `/logs`.
- No silent failure.

## 3.5 Web results readability controls

1. Open Logs Viewer from slash card.
2. Run query with structured JSON-like lines.
3. Validate:
   - message view toggle (`Pretty` / `Raw`)
   - wrap on/off
   - row expand/collapse
   - copy line
   - row metadata chips (`chars`, `lines`, format, preview)

Expected:
- No row overlap artifacts.
- Expand/collapse updates row height correctly.
- Copy line works or shows clear browser limitation.

## 3.6 API probe noise

1. Open browser DevTools network tab.
2. Reload web UI and run `/config` + `/query` path.

Expected:
- Private app API path is attempted first.
- No misleading public-first probe sequence.

## 4. Pass/Fail Record

| Check | Result | Evidence (private storage ref) | Notes |
|------|--------|----------|-------|
| Slash privacy | `PASS/FAIL` | `screenshots/02-slash-private-panel.png` | Private contextual bar shows "Only you can see this /logs response". |
| Summary readability | `PASS/FAIL` | `screenshots/02-slash-private-panel.png` | Numbered preview, top levels/signals, and chat-size cap note visible. |
| Show copy-ready sample | `PASS/FAIL` | `screenshots/03-copy-ready-sample.png` | Private copy-ready sample message rendered in room context as user-only action response. |
| Share sample + audit | `PASS/FAIL` | `network/04-workspace-ui-interaction-resmoke-pass.har`, `screenshots/08-share-resmoke-pass.png` | Re-smoke should show `api/apps/ui.interaction` returning `200` and room-visible share output. |
| Stale snapshot fail-safe | `PENDING` | `screenshots/04-stale-snapshot.png` | |
| Web readability controls | `PENDING` | `screenshots/06-web-results-view.png` | |
| Private-first probe behavior | `PENDING` | `network/05-localhost-devtools.har` | |

## 5. Evidence Collection

Capture:

1. App version and timestamp.
2. Workspace version (`/api/info`).
3. Screenshots:
   - slash private panel
   - copy/share outcomes
   - web readability controls
4. DevTools network excerpt for API base resolution.
5. App logs around action click times.

Recommended filenames:

1. `screenshots/01-summary-preview.png`
2. `screenshots/02-slash-private-panel.png`
3. `screenshots/03-copy-ready-sample.png`
4. `screenshots/04-stale-snapshot.png`
5. `screenshots/05-audit-view.png`
6. `screenshots/06-web-results-view.png`
7. `network/01-workspace-ui-interaction.har` (or screenshot if HAR unavailable)
8. `app-logs/01-action-window.log`
9. `notes/run-notes.md`

## 6. Exit Criteria

Release is considered validated when checks above pass or accepted deviations are documented with remediation owner/date.
