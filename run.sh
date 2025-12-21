#!/bin/bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./run.sh [--dev|-d] [--prod|-p] [-h]

  -d, --dev   (default) Build Debug + run Vite dev server (app loads http://localhost:5173)
  -p, --prod  Build Release + run bundled web UI (no dev server)
  -h          Show this help

Notes:
  - This script builds an unsigned app (`CODE_SIGNING_ALLOWED=NO`). Distribution builds
    should follow the signing/notarization runbook.
  - Override build output location with DERIVED_DATA_PATH, e.g.:
      DERIVED_DATA_PATH=/tmp/ticker-xcode-build ./run.sh --prod
EOF
}

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DERIVED_DATA_PATH_DEFAULT="$ROOT_DIR/.build/xcode"
DERIVED_DATA_PATH="${TICKER_DERIVED_DATA_PATH:-$DERIVED_DATA_PATH_DEFAULT}"
APP="$DERIVED_DATA_PATH/Build/Products"

MODE="dev"
while [[ $# -gt 0 ]]; do
  case "$1" in
  -d | --dev)
    MODE="dev"
    shift
    ;;
  -p | --prod)
    MODE="prod"
    shift
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown argument: $1" >&2
    usage
    exit 2
    ;;
  esac
done

build_app() {
  local configuration="$1"

  echo "Building Ticker ($configuration)..."
  cd "$ROOT_DIR"

  local -a extra_build_settings=()
  if [[ "$configuration" == "Release" ]]; then
    local build_number
    build_number="$(git rev-list --count HEAD 2>/dev/null || echo 1)"
    extra_build_settings+=("CURRENT_PROJECT_VERSION=$build_number")
  fi

  if [[ ${#extra_build_settings[@]} -gt 0 ]]; then
    xcodebuild build \
      -project Ticker.xcodeproj \
      -scheme Ticker \
      -configuration "$configuration" \
      -destination 'platform=macOS' \
      -derivedDataPath "$DERIVED_DATA_PATH" \
      CODE_SIGNING_ALLOWED=NO \
      "${extra_build_settings[@]}" \
      -quiet
  else
    xcodebuild build \
      -project Ticker.xcodeproj \
      -scheme Ticker \
      -configuration "$configuration" \
      -destination 'platform=macOS' \
      -derivedDataPath "$DERIVED_DATA_PATH" \
      CODE_SIGNING_ALLOWED=NO \
      -quiet
  fi
}

run_dev() {
  local app_path="$APP/Debug/Ticker.app"
  local bin_path="$app_path/Contents/MacOS/Ticker"

  build_app "Debug"

  echo "Cleaning up port 5173..."
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true

  echo "Starting Vite dev server..."
  (cd "$ROOT_DIR/Web" && npm run dev) &
  local vite_pid=$!
  trap "kill $vite_pid 2>/dev/null || true" EXIT

  sleep 2

  if [[ ! -x "$bin_path" ]]; then
    echo "Error: expected app executable not found at: $bin_path" >&2
    echo "Build output should be at: $app_path" >&2
    exit 1
  fi

  echo "Running Ticker (dev)..."
  "$bin_path"
}

run_prod() {
  local app_path="$APP/Release/Ticker.app"

  echo "Building bundled Web assets..."
  if [[ ! -d "$ROOT_DIR/Web/node_modules" ]]; then
    (cd "$ROOT_DIR/Web" && npm ci)
  fi
  (cd "$ROOT_DIR/Web" && npm run build)

  build_app "Release"

  if [[ ! -d "$app_path" ]]; then
    echo "Error: expected app bundle not found at: $app_path" >&2
    exit 1
  fi

  echo "Launching Ticker (prod)..."
  open "$app_path"
}

case "$MODE" in
dev) run_dev ;;
prod) run_prod ;;
*)
  echo "Invalid mode: $MODE" >&2
  exit 2
  ;;
esac
