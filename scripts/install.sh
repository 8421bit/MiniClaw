#!/bin/bash
# MiniClaw Universal Installer v0.5.0 (The Nervous System)
# Interactive setup: Build + Configure MCP for your preferred client

set -e

# Resolve paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_PATH="$PLUGIN_ROOT/dist/index.js"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

echo -e "${CYAN}🐯 MiniClaw v0.5.0 Installer (The Nervous System)${NC}"
echo "==================================================="
echo ""

# 1. Build Project
echo -e "${BLUE}[Step 1/2] Building Project...${NC}"
cd "$PLUGIN_ROOT"
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi
npm run build
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

echo ""

# 2. Interactive Client Selection
echo -e "${BLUE}[Step 2/2] Configure MCP Client${NC}"
echo ""

# Client data
declare -a CLIENTS=(
    "Claude Code|$HOME/.config/claude-code/config.json"
    "Claude Desktop|$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    "Cursor|$HOME/.cursor/mcp.json"
    "Windsurf|$HOME/.codeium/windsurf/mcp_config.json"
    "Antigravity|$HOME/.gemini/antigravity/mcp_config.json"
    "Qoder/千问|$HOME/.qoder/mcp.json"
)

# Selection state
declare -a SELECTED=(0 0 0 0 0 0)
CURRENT=0
TOTAL=${#CLIENTS[@]}

# Function to render menu
render_menu() {
    # Move cursor up to redraw
    if [ "$1" = "refresh" ]; then
        tput cuu $((TOTAL + 3))
    fi
    
    echo -e "${BOLD}选择要配置的客户端:${NC}"
    echo -e "${DIM}  ↑↓ 移动  空格 选择  Enter 确认${NC}"
    echo ""
    
    for i in "${!CLIENTS[@]}"; do
        IFS='|' read -ra PARTS <<< "${CLIENTS[$i]}"
        local name="${PARTS[0]}"
        local path="${PARTS[1]}"
        local short_path=$(echo "$path" | sed "s|$HOME|~|")
        
        local prefix="  "
        local checkbox="[ ]"
        local style=""
        
        if [ "$i" -eq "$CURRENT" ]; then
            prefix="> "
            style="${CYAN}"
        fi
        
        if [ "${SELECTED[$i]}" -eq 1 ]; then
            checkbox="${GREEN}[✓]${NC}"
        fi
        
        echo -e "${style}${prefix}${checkbox} ${name}${NC} ${DIM}(${short_path})${NC}"
    done
}

# Function to read single key
read_key() {
    local key
    IFS= read -rsn1 key
    
    # Handle escape sequences (arrow keys)
    if [[ $key == $'\x1b' ]]; then
        read -rsn2 -t 1 key
        case "$key" in
            '[A') echo "up" ;;
            '[B') echo "down" ;;
            *) echo "other" ;;
        esac
    elif [[ $key == "" ]]; then
        echo "enter"
    elif [[ $key == " " ]]; then
        echo "space"
    else
        echo "other"
    fi
}

# Initial render
render_menu

# Interactive loop
while true; do
    key=$(read_key)
    
    case "$key" in
        up)
            if [ $CURRENT -gt 0 ]; then
                CURRENT=$((CURRENT - 1))
            fi
            render_menu "refresh"
            ;;
        down)
            if [ $CURRENT -lt $((TOTAL - 1)) ]; then
                CURRENT=$((CURRENT + 1))
            fi
            render_menu "refresh"
            ;;
        space)
            if [ "${SELECTED[$CURRENT]}" -eq 0 ]; then
                SELECTED[$CURRENT]=1
            else
                SELECTED[$CURRENT]=0
            fi
            render_menu "refresh"
            ;;
        enter)
            echo ""
            break
            ;;
    esac
done

# Function to configure a client
configure_client() {
    local config_file="$1"
    local client_name="$2"
    local config_dir="$(dirname "$config_file")"
    
    mkdir -p "$config_dir"
    
    node -e "
const fs = require('fs');
const configFile = '$config_file';
const distPath = '$DIST_PATH';
const backupFile = configFile + '.backup.' + Date.now();

let config = {};
if (fs.existsSync(configFile)) {
    try {
        const raw = fs.readFileSync(configFile, 'utf8');
        config = JSON.parse(raw);
        fs.writeFileSync(backupFile, raw);
    } catch (e) {
        console.error('❌ Error: ' + e.message);
        process.exit(1);
    }
}

if (!config.mcpServers) {
    config.mcpServers = {};
}

const miniclawConfig = {
    command: 'node',
    args: [distPath],
    env: {
        MINICLAW_TOKEN_BUDGET: '12000'
    }
};

const currentConfig = config.mcpServers.miniclaw;
// Check minimal equality (command + args[0])
// We force update for v2.0 env vars
config.mcpServers.miniclaw = miniclawConfig;
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
"
    echo -e "${GREEN}  ✅ $client_name${NC}"
}

# Process selections
configured=false
for i in "${!SELECTED[@]}"; do
    if [ "${SELECTED[$i]}" -eq 1 ]; then
        IFS='|' read -ra PARTS <<< "${CLIENTS[$i]}"
        name="${PARTS[0]}"
        path="${PARTS[1]}"
        
        if [ "$configured" = false ]; then
            echo -e "${BLUE}Configuring selected clients...${NC}"
            configured=true
        fi
        
        configure_client "$path" "$name"
    fi
done

if [ "$configured" = false ]; then
    echo -e "${YELLOW}⏭️  未选择任何客户端，跳过配置${NC}"
fi

# Finale
echo ""
echo "=================================="
echo -e "${GREEN}🎉 MiniClaw v0.5.0 (Nervous System) 安装完成!${NC}"
echo ""
if [ "$configured" = true ]; then
    echo -e "${CYAN}下一步:${NC}"
    echo "1. 重启你的 MCP 客户端"
    echo "2. 享受 Workspace Intelligence & Executable Skills"
    echo ""
fi
echo -e "Have fun! 🐯"
