#!/bin/bash

# Start Vite dev server and Swift app together
# Usage: ./dev.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Start Vite in background
echo "Starting Vite dev server..."
(cd "$ROOT_DIR/Web" && npm run dev) &
VITE_PID=$!

# Cleanup on exit
trap "kill $VITE_PID 2>/dev/null || true" EXIT

# Wait for Vite to be ready
sleep 2

# Build and run Swift app
echo "Building and running Ticker..."
cd "$ROOT_DIR"
swift run
