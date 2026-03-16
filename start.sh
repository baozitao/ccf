#!/bin/bash
cd "$(dirname "$0")"
npx electron-vite build --mode production 2>/dev/null
echo "Clui CC running. Cmd+Shift+K to toggle. Use ./stop.sh or tray icon > Quit to close."
npx electron .
