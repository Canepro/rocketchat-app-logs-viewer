#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Run release-readiness checks for this repository.

Usage:
  scripts/release-checklist.sh [--release-version <semver>] [--no-gates]

Options:
  --release-version <semver>  Validate app.json version matches the target release version.
  --no-gates                  Skip runtime quality gates (test/typecheck/build/package).
  -h, --help                  Show this help.

Examples:
  scripts/release-checklist.sh
  scripts/release-checklist.sh --release-version 0.1.2
  scripts/release-checklist.sh --no-gates
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RELEASE_VERSION=""
RUN_GATES="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-version)
      RELEASE_VERSION="${2:-}"
      shift 2
      ;;
    --no-gates)
      RUN_GATES="false"
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

if [[ -n "$RELEASE_VERSION" && ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid --release-version value: $RELEASE_VERSION (expected x.y.z)" >&2
  exit 1
fi

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "[PASS] $1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  echo "[WARN] $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "[FAIL] $1"
}

print_summary() {
  echo
  echo "== Summary =="
  echo "Pass: $PASS_COUNT"
  echo "Warn: $WARN_COUNT"
  echo "Fail: $FAIL_COUNT"
}

check_file_exists() {
  local path="$1"
  if [[ -f "$path" ]]; then
    pass "Found required file: $path"
  else
    fail "Missing required file: $path"
  fi
}

echo "== Release Checklist =="
echo "Repository: $ROOT_DIR"

MISSING_TOOLS=0
for tool in node rg; do
  if command -v "$tool" >/dev/null 2>&1; then
    pass "Tool available: $tool"
  else
    fail "Required tool is missing: $tool"
    MISSING_TOOLS=1
  fi
done

if [[ "$MISSING_TOOLS" -gt 0 ]]; then
  print_summary
  exit 1
fi

APP_VERSION="$(node -p "require('./app.json').version" 2>/dev/null || true)"
PKG_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"

if [[ -n "$APP_VERSION" ]]; then
  pass "app.json version detected: $APP_VERSION"
else
  fail "Unable to read app.json version"
fi

if [[ -n "$PKG_VERSION" ]]; then
  pass "package.json version detected: $PKG_VERSION"
else
  warn "Unable to read package.json version"
fi

if [[ -n "$RELEASE_VERSION" && -n "$APP_VERSION" ]]; then
  if [[ "$APP_VERSION" == "$RELEASE_VERSION" ]]; then
    pass "app.json version matches requested release version: $RELEASE_VERSION"
  else
    fail "app.json version ($APP_VERSION) does not match --release-version ($RELEASE_VERSION)"
  fi
fi

if [[ -n "$APP_VERSION" ]]; then
  if rg -n "## \\[$APP_VERSION\\]" CHANGELOG.md >/dev/null 2>&1; then
    pass "CHANGELOG.md contains version heading for $APP_VERSION"
  else
    warn "CHANGELOG.md has no heading for app.json version $APP_VERSION (expected format: ## [$APP_VERSION])"
  fi
else
  fail "APP_VERSION is empty; cannot verify CHANGELOG.md version heading"
fi

if [[ -n "$APP_VERSION" ]]; then
  if rg -n "\"version\": \"$APP_VERSION\"" docs/VERSION_TRACKER.md >/dev/null 2>&1 || rg -n "$APP_VERSION" docs/VERSION_TRACKER.md >/dev/null 2>&1; then
    pass "docs/VERSION_TRACKER.md references app.json version $APP_VERSION"
  else
    warn "docs/VERSION_TRACKER.md does not reference app.json version $APP_VERSION"
  fi
else
  fail "APP_VERSION is empty; cannot verify docs/VERSION_TRACKER.md references"
fi

check_file_exists ".rcappsconfig"
check_file_exists "CHANGELOG.md"
check_file_exists "docs/RELEASE_WORKFLOW.md"
check_file_exists "docs/MARKETPLACE_CHECKLIST.md"
check_file_exists "docs/RUNBOOK.md"
check_file_exists "docs/SMOKE_CHECKLIST.md"
check_file_exists "docs/VERSION_TRACKER.md"
check_file_exists "docs/GITHUB_PUSH_PLAN.md"
check_file_exists ".github/workflows/ci.yml"

if rg -n "\"@rocket.chat/apps-engine\"" package.json >/dev/null 2>&1; then
  pass "@rocket.chat/apps-engine is present in package.json"
else
  fail "@rocket.chat/apps-engine is missing from package.json"
fi

if rg -n "web/\\*\\*" .rcappsconfig >/dev/null 2>&1 && rg -n "tests/\\*\\*" .rcappsconfig >/dev/null 2>&1; then
  pass ".rcappsconfig includes workspace ignore patterns for web/** and tests/**"
else
  warn ".rcappsconfig may be missing expected ignore patterns for web/** and tests/**"
fi

if [[ "$RUN_GATES" == "true" ]]; then
  echo
  echo "== Quality Gates =="
  QUALITY_CMDS=(
    "test"
    "typecheck"
    "build"
    "package"
  )

  for cmd in "${QUALITY_CMDS[@]}"; do
    echo "Running: bun run $cmd"
    if bun run "$cmd"; then
      pass "Quality gate passed: bun run $cmd"
    else
      fail "Quality gate failed: bun run $cmd"
    fi
  done

  if [[ -n "$APP_VERSION" && -f "dist/logs-viewer_${APP_VERSION}.zip" ]]; then
    pass "Packaged artifact exists: dist/logs-viewer_${APP_VERSION}.zip"
  else
    warn "Expected packaged artifact not found: dist/logs-viewer_${APP_VERSION}.zip"
  fi
else
  warn "Skipped quality gates (--no-gates)"
fi

print_summary

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi

exit 0
