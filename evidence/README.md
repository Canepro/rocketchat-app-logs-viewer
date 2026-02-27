# Evidence Handling Policy

This folder keeps only repository-safe evidence structure.

## Do not commit

Never commit raw operational artifacts from real workspaces, including:

- HAR files
- screenshots containing logs/user/session metadata
- raw app/server log exports
- run notes containing tenant IDs, user IDs, hostnames, tokens, or internal URLs

## What stays in git

- folder structure (`.gitkeep` files)
- redacted templates/checklists
- sanitized summaries that contain no tenant-identifying data
- optional sanitized showcase images under `evidence/**/screenshots/public/`

## Public showcase images

If you want visuals in a public repo:

1. Place only sanitized images in `evidence/**/screenshots/public/`.
2. Ensure no user IDs, tokens, hostnames, internal URLs, or sensitive log lines are visible.
3. Prefer cropped UI-focused screenshots over full desktop captures.

## Where raw evidence should live

Store raw artifacts in private storage outside this repository, for example:

- encrypted team drive
- private incident ticket attachments
- private object storage bucket with retention policy

## Publication checklist

Before making this repository public:

1. confirm no `*.har` files are tracked
2. confirm only sanitized screenshots are tracked under `evidence/**/screenshots/public/`
3. confirm notes are redacted/sanitized
4. run `git status` and `git ls-files evidence` to verify
