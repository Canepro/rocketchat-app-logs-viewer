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
5. Confirm audit contains corresponding action.

Expected:
- Copy is private.
- Share is room/thread-visible and audited.
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

| Check | Result | Evidence |
|------|--------|----------|
| Slash privacy | `PASS/FAIL` | screenshot/log |
| Summary readability | `PASS/FAIL` | screenshot |
| Copy sample | `PASS/FAIL` | screenshot/log |
| Share sample + audit | `PASS/FAIL` | screenshot/log |
| Stale snapshot fail-safe | `PASS/FAIL` | screenshot/log |
| Web readability controls | `PASS/FAIL` | screenshot/video |
| Private-first probe behavior | `PASS/FAIL` | network capture |

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

## 6. Exit Criteria

Release candidate may advance when all checks above pass or accepted deviations are documented with remediation owner/date.
