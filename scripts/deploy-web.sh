#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Sync built web assets for same-origin hosting.

Usage:
  scripts/deploy-web.sh --target <directory> [--source <directory>] [--no-delete]

Options:
  --target <directory>   Required destination directory served by your web server.
  --source <directory>   Source directory (default: resources/web).
  --no-delete            Keep extra files in target (skip rsync --delete).
  -h, --help             Show this help.

Examples:
  scripts/deploy-web.sh --target /srv/rocketchat/logs-viewer
  scripts/deploy-web.sh --target /srv/rocketchat/logs-viewer --no-delete
EOF
}

SOURCE_DIR="resources/web"
TARGET_DIR=""
DELETE_MODE="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_DIR="${2:-}"
      shift 2
      ;;
    --source)
      SOURCE_DIR="${2:-}"
      shift 2
      ;;
    --no-delete)
      DELETE_MODE="false"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  echo "Missing required argument: --target <directory>" >&2
  usage >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source directory not found: $SOURCE_DIR" >&2
  echo "Run 'bun run build' first." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

if command -v rsync >/dev/null 2>&1; then
  RSYNC_FLAGS=(-a)
  if [[ "$DELETE_MODE" == "true" ]]; then
    RSYNC_FLAGS+=(--delete)
  fi
  rsync "${RSYNC_FLAGS[@]}" "$SOURCE_DIR"/ "$TARGET_DIR"/
else
  echo "rsync is not installed; falling back to cp -a (stale files may remain)." >&2
  cp -a "$SOURCE_DIR"/. "$TARGET_DIR"/
fi

echo "Web assets synced: $SOURCE_DIR -> $TARGET_DIR"
