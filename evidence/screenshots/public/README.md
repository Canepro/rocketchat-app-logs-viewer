# Public Screenshot Redaction Checklist

Use this folder only for sanitized showcase screenshots that are safe for a public repository.

## Allowed

- UI-focused screenshots that demonstrate product behavior
- Cropped or edited views that remove environment-specific details
- Mocked or synthetic data created for demos

## Not allowed

- User IDs, usernames, emails, avatars, or personal profile data
- Tokens, cookies, auth headers, session IDs, API keys, passwords
- Internal hostnames, private URLs, IP addresses, cluster names, pod names
- Raw log lines that reveal tenant/system-sensitive details

## Before committing

1. Crop to the minimum area needed to explain the feature.
2. Blur or mask any identifiers and secrets.
3. Verify browser tabs, bookmarks, desktop notifications, and taskbar are hidden.
4. Confirm filename is descriptive and generic (for example `slash-private-panel-redacted.png`).
5. Re-open the image and do a final visual check at 100% zoom.

## Naming convention

- `feature-name-redacted.png`
- `feature-name-redacted-2.png`

Keep this folder curated. Remove outdated images when behavior changes.
