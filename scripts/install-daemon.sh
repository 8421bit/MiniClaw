#!/bin/bash

# MiniClaw Daemon Installer (macOS)
# ---------------------------------
# This script sets up MiniClaw's autonomic brainstem as a background service.

set -e

REPO_ROOT=$(pwd)
MINICLAW_DATA_DIR="$HOME/.miniclaw"
LOG_DIR="$MINICLAW_DATA_DIR/logs"
PLIST_NAME="com.miniclaw.daemon.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "🧬 Hatching MiniClaw Autonomous Embryo..."

# 1. Ensure logs directory exists
mkdir -p "$LOG_DIR"

# 2. Rebuild the project to ensure latest daemon.js
echo "🔨 Building project..."
pnpm build

# 3. Resolve paths
NODE_PATH=$(which node)
DIST_PATH="$REPO_ROOT/dist"

if [ -z "$NODE_PATH" ]; then
    echo "❌ Error: 'node' not found in PATH."
    exit 1
fi

# 4. Process plist template
echo "📝 Generating LaunchAgent configuration..."
sed -e "s|{{NODE_PATH}}|$NODE_PATH|g" \
    -e "s|{{DIST_PATH}}|$DIST_PATH|g" \
    -e "s|{{LOG_DIR}}|$LOG_DIR|g" \
    "$REPO_ROOT/templates/$PLIST_NAME" > "$TARGET_PLIST"

# 5. Load the daemon
echo "🚀 Loading MiniClaw Daemon..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true
launchctl load "$TARGET_PLIST"

echo "--------------------------------------------------"
echo " ✅ MiniClaw Daemon installed and active!"
echo " 📂 Logs: $LOG_DIR/daemon.log"
echo " 💓 The embryo is now breathing independently."
echo "--------------------------------------------------"
