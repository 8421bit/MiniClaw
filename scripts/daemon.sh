#!/bin/bash
# =============================================================================
# MiniClaw Daemon Manager (Unified Controller)
#
# Manages the standalone MiniClaw background process (daemon.js).
# This process is completely independent of any IDE, running its own
# autonomic heartbeat and executing tasks via AI CLI (claude/gemini).
#
# USAGE:
#   ./daemon.sh install   — Install macOS LaunchAgent (recommended for Mac)
#   ./daemon.sh uninstall — Remove LaunchAgent
#   ./daemon.sh start     — Manually start the daemon via nohup (for Linux/Win/testing)
#   ./daemon.sh stop      — Stop the nohup daemon
#   ./daemon.sh status    — Show daemon status and recent logs
#   ./daemon.sh pulse     — Force a one-off cognitive pulse
# =============================================================================

set -euo pipefail

# --- Paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MINICLAW_DIR="$HOME/.miniclaw"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
MINICLAW_LAUNCHD_DIR="$MINICLAW_DIR/launchd"
LOG_DIR="$MINICLAW_DIR/logs"
DAEMON_LOG="$LOG_DIR/daemon.log"
DAEMON_PID_FILE="/tmp/miniclaw-daemon.pid"

DAEMON_PLIST_ID="com.miniclaw.daemon"
DAEMON_PLIST_FILE="$MINICLAW_LAUNCHD_DIR/$DAEMON_PLIST_ID.plist"
DAEMON_PLIST_SYMLINK="$LAUNCH_AGENTS_DIR/$DAEMON_PLIST_ID.plist"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

# =============================================================================
# Core Resolution (Source Mode vs Global Mode)
# =============================================================================
resolve_daemon_path() {
    if [ -f "$ROOT_DIR/package.json" ]; then
        # Developer / Clone Mode
        echo "Source mode detected. Building project..."
        cd "$ROOT_DIR"
        npm install > /dev/null 2>&1 || true
        npm run build > /dev/null
        DAEMON_JS_PATH="$ROOT_DIR/dist/daemon.js"
        NODE_CWD="$ROOT_DIR"
    else
        # Zero-Install / NPX Mode
        echo "Standalone mode detected at $SCRIPT_DIR."
        echo "Installing/Updating miniclaw globally..."
        npm install -g github:8421bit/miniclaw > /dev/null
        
        GLOBAL_ROOT="$(npm root -g)"
        DAEMON_JS_PATH="$GLOBAL_ROOT/miniclaw/dist/daemon.js"
        NODE_CWD="$GLOBAL_ROOT/miniclaw"
        
        if [ ! -f "$DAEMON_JS_PATH" ]; then
            echo -e "${RED}Error: Failed to locate global miniclaw installation at $DAEMON_JS_PATH${NC}"
            exit 1
        fi
    fi
}

# =============================================================================
# macOS LaunchAgent Management
# =============================================================================
cmd_install() {
    echo "Installing MiniClaw Autonomous Daemon (LaunchAgent)..."
    mkdir -p "$LAUNCH_AGENTS_DIR" "$MINICLAW_LAUNCHD_DIR" "$LOG_DIR"
    
    resolve_daemon_path
    ok "Resolved daemon path: $DAEMON_JS_PATH"

    cat > "$DAEMON_PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$DAEMON_PLIST_ID</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$DAEMON_JS_PATH</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$NODE_CWD</string>
    <key>StandardOutPath</key>
    <string>$DAEMON_LOG</string>
    <key>StandardErrorPath</key>
    <string>$DAEMON_LOG</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF
    ok "Generated daemon plist: $DAEMON_PLIST_FILE"

    chmod +x "$SCRIPT_DIR/daemon.sh"
    ln -sf "$DAEMON_PLIST_FILE" "$DAEMON_PLIST_SYMLINK"
    launchctl unload "$DAEMON_PLIST_SYMLINK" 2>/dev/null || true
    launchctl load "$DAEMON_PLIST_SYMLINK"
    ok "Loaded macOS daemon (starts automatically on login)"

    echo ""
    echo -e "${GREEN}Installation complete!${NC}"
    echo "  Log       : $DAEMON_LOG"
    echo ""
}

cmd_uninstall() {
    echo "Uninstalling MiniClaw LaunchAgent Daemon..."
    launchctl unload "$DAEMON_PLIST_SYMLINK" 2>/dev/null || true
    rm -f "$DAEMON_PLIST_SYMLINK" "$DAEMON_PLIST_FILE"
    ok "Uninstalled macOS LaunchAgent."
}

# =============================================================================
# Nohup Management (Linux / Manual Test)
# =============================================================================
cmd_start() {
    echo "Starting MiniClaw Daemon (nohup)..."
    mkdir -p "$LOG_DIR"
    resolve_daemon_path
    
    cd "$NODE_CWD"
    nohup node "$DAEMON_JS_PATH" >> "$DAEMON_LOG" 2>&1 &
    echo $! > "$DAEMON_PID_FILE"
    ok "Daemon started (PID: $(cat "$DAEMON_PID_FILE"))"
}

cmd_stop() {
    if [ -f "$DAEMON_PID_FILE" ]; then
        pid=$(cat "$DAEMON_PID_FILE")
        echo "Stopping Daemon (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        rm -f "$DAEMON_PID_FILE"
        ok "Stopped."
    else
        pkill -f "node dist/daemon.js" || true
        ok "Stopped via pkill."
    fi
}

cmd_status() {
    echo "MiniClaw Daemon Status:"
    
    # 1. Check LaunchAgent
    if command -v launchctl >/dev/null 2>&1; then
        launchctl list | grep -q "$DAEMON_PLIST_ID" \
            && ok  "macOS LaunchAgent : ACTIVE" \
            || warn "macOS LaunchAgent : INACTIVE"
    fi
    
    # 2. Check nohup
    pgrep -f "node dist/daemon.js" > /dev/null \
        && ok  "Node Process      : RUNNING" \
        || warn "Node Process      : STOPPED"
        
    echo ""
    echo "Recent daemon log ($DAEMON_LOG):"
    tail -n 10 "$DAEMON_LOG" 2>/dev/null || echo "  (no logs yet)"
}

cmd_pulse() {
    echo "Forcing manual cognitive pulse..."
    cd "$ROOT_DIR"
    node -e "import { ContextKernel } from './dist/kernel.js'; const k = new ContextKernel(); k.heartbeat().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });"
}

# =============================================================================
# Main dispatch
# =============================================================================
case "${1:-status}" in
    install)    cmd_install    ;;
    uninstall)  cmd_uninstall  ;;
    start)      cmd_start      ;;
    stop)       cmd_stop       ;;
    status)     cmd_status     ;;
    pulse)      cmd_pulse      ;;
    *)
        echo "Usage: $0 {install|uninstall|start|stop|status|pulse}"
        exit 1
        ;;
esac
