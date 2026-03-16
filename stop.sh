#!/bin/bash
pkill -f "CLUI/node_modules/electron" 2>/dev/null
pkill -f "CLUI/dist/main" 2>/dev/null
echo "Clui CC stopped."
