# 4PM Cluster Smoke Checklist

Operational run-sheet for first live validation after cluster auto-start.

Last updated: 2026-02-26

## 1. Goal

Validate `v0.1.1` candidate behavior end-to-end in a live Rocket.Chat workspace without changing release scope.

## 2. Preconditions

1. Cluster and workspace are healthy.
2. App is enabled with current package (`logs-viewer_0.1.0.zip` build containing `v0.1.1` candidate changes).
3. Non-secret settings are confirmed:
   - `logs_source_mode`
   - `required_label_selector`
   - `allowed_roles`
   - `workspace_permission_mode`
   - `workspace_permission_code`
4. Test users available:
   - one allowed operator
   - one denied user

## 2.1 Pre-filled run metadata (update at execution time)

| Field | Value |
|------|-------|
| Date | `2026-02-26` |
| Planned start | `16:00 local` |
| Actual start | `16:17 local` |
| Branch | `feature/v0.1.1-in-chat-ux` |
| Candidate artifact | `dist/logs-viewer_0.1.0.zip` |
| Artifact SHA256 | `b14a8b0719ad3e86ff8ca1d6fd292d580fa2bcc0d39522bd5501dd475bbaff40` |
| Evidence root | `evidence/2026-02-26-v0.1.1-smoke/` |
| Allowed user | `canepro` (observed in screenshot) |
| Denied user | `TBD` |
| Target room | `Support_Stuff` |
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

1. Click `Copy sample`.
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
3. Click `Copy sample` on stale card.

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

| Check | Result | Evidence | Notes |
|------|--------|----------|-------|
| Slash privacy | `PASS` | `screenshots/Screenshot_side_view.png` | Private contextual bar shows "Only you can see this /logs response". |
| Summary readability | `PASS` | `screenshots/Screenshot_side_view.png` | Numbered preview, top levels/signals, and chat-size cap note visible. |
| Copy sample | `PASS` | `screenshots/Screenshot_copy.png` | Private copy-ready sample message rendered in room context as user-only action response. |
| Share sample + audit | `FAIL (diagnosed)` | `evidence/2026-02-26-v0.1.1-smoke/network/k8.canepro.me_from the workspaace2.har`, `evidence/2026-02-26-v0.1.1-smoke/network/k8.canepro.me_from the workspaace3.har` | Two root causes confirmed in Rocket.Chat logs: `error-message-size-exceeded` and then `Setting "Message_MaxAllowedSize" does not exist.`. Fixes implemented in current branch (chat-size-aware truncation + safe optional setting read); re-smoke required. |
| Stale snapshot fail-safe | `PENDING` | `evidence/2026-02-26-v0.1.1-smoke/screenshots/` | |
| Web readability controls | `PENDING` | `evidence/2026-02-26-v0.1.1-smoke/screenshots/` | |
| Private-first probe behavior | `PENDING` | `evidence/2026-02-26-v0.1.1-smoke/network/` | |

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

1. `screenshots/01-slash-private.png`
2. `screenshots/02-summary-preview.png`
3. `screenshots/03-copy-sample.png`
4. `screenshots/04-share-sample-audit.png`
5. `screenshots/05-stale-snapshot.png`
6. `screenshots/06-web-readability-controls.png`
7. `network/01-private-first-probe.har` (or screenshot if HAR unavailable)
8. `app-logs/01-action-window.log`
9. `notes/run-notes.md`

## 6. Exit Criteria

Release candidate may advance when all checks above pass or accepted deviations are documented with remediation owner/date.
