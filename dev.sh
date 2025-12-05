#!/bin/bash

# Start Vite dev server and Swift app together
# Usage: ./dev.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT_DIR/.build/xcode"
BINARY="$BUILD_DIR/Build/Products/Debug/Ticker"

# Kill any existing processes on port 5173
echo "Cleaning up port 5173..."
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

# Start Vite in background
echo "Starting Vite dev server..."
(cd "$ROOT_DIR/Web" && npm run dev) &
VITE_PID=$!

# Cleanup on exit
trap "kill $VITE_PID 2>/dev/null || true" EXIT

# Wait for Vite to be ready
sleep 2

# Build with xcodebuild (required for MLX Metal shaders)
echo "Building Ticker with xcodebuild..."
cd "$ROOT_DIR"
xcodebuild build -scheme Ticker -destination 'platform=OS X' -derivedDataPath "$BUILD_DIR" -quiet

# Run the built binary
echo "Running Ticker..."
"$BINARY"
