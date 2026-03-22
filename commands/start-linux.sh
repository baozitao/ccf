#!/bin/bash
set -e

cd "$(dirname "$0")/.."

if [ ! -d "node_modules" ]; then
  echo "Dependencies not installed. Run: npm install"
  exit 1
fi

# Clean stale PID file
PID_FILE=".clui.pid"
if [ -f "$PID_FILE" ]; then
  old_pid=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$old_pid" ] && ! kill -0 "$old_pid" 2>/dev/null; then
    rm -f "$PID_FILE"
  fi
fi

echo "Building Clui CC..."
if ! npx electron-vite build --mode production; then
  echo "Build failed. Try: rm -rf node_modules && npm install"
  exit 1
fi

# Copy fab.html (not bundled by vite)
cp -f src/renderer/fab.html dist/renderer/fab.html 2>/dev/null

echo "Clui CC running. F3 to toggle."

# Ozone platform flags for Wayland support (globalShortcut, transparent windows)
export ELECTRON_OZONE_PLATFORM_HINT=auto

npx electron . --ozone-platform-hint=auto --enable-features=WaylandWindowDecorations &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

wait "$APP_PID" 2>/dev/null
rm -f "$PID_FILE"
