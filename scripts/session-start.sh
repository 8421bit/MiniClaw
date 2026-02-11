#!/bin/bash

# Configuration
# CLAUDE_PLUGIN_ROOT is injected by Claude Code
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
MINICLAW_DIR="$HOME/.miniclaw"

if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: CLAUDE_PLUGIN_ROOT is not set."
  exit 1
fi

TEMPLATES_DIR="$PLUGIN_ROOT/templates"

# 1. Bootstrap Directory
if [ ! -d "$MINICLAW_DIR" ]; then
  echo "initializing miniclaw at $MINICLAW_DIR..."
  mkdir -p "$MINICLAW_DIR"
  cp "$TEMPLATES_DIR/"*.md "$MINICLAW_DIR/" 2>/dev/null
  if [ $? -eq 0 ]; then
      echo "✅ MiniClaw Bootstrap Complete."
      echo "Context files created at ~/.miniclaw/"
      echo ""
      echo "📜 BOOTSTRAP.md exists — this is your first run!"
      echo "   The agent will guide you through initial setup."
      echo "   Delete BOOTSTRAP.md after setup is complete."
  else
      echo "⚠️ Warning: Templates not found at $TEMPLATES_DIR. Created empty directory."
  fi
else
  # Check for updates (e.g. new templates like HEARTBEAT)
  for tpl in HEARTBEAT.md MEMORY.md; do
      if [ ! -f "$MINICLAW_DIR/$tpl" ] && [ -f "$TEMPLATES_DIR/$tpl" ]; then
          cp "$TEMPLATES_DIR/$tpl" "$MINICLAW_DIR/"
          echo "Added missing template: $tpl"
      fi
  done
fi

# 2. Daily Memory Generation
MEMORY_DIR="$MINICLAW_DIR/memory"
TODAY=$(date +%Y-%m-%d)
TODAY_FILE="$MEMORY_DIR/$TODAY.md"

if [ ! -d "$MEMORY_DIR" ]; then
    mkdir -p "$MEMORY_DIR"
fi

if [ ! -f "$TODAY_FILE" ]; then
    echo "# Memory Log: $TODAY" > "$TODAY_FILE"
    echo "" >> "$TODAY_FILE"
    echo "Sessions started today." >> "$TODAY_FILE"
    echo "✅ Daily memory initialized: $TODAY.md"
fi
