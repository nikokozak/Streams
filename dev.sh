#!/bin/bash

# Start Vite dev server and Swift app together
# Usage: ./dev.sh

set -e

cd "$(dirname "$0")"

# Start Vite in background
echo "Starting Vite dev server..."
cd Web && npm run dev &
VITE_PID=$!

# Wait for Vite to be ready
sleep 2

# Build and run Swift app
echo "Building and running Ticker..."
cd ..
swift run

# Cleanup on exit
kill $VITE_PID 2>/dev/null || true
