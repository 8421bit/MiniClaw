<div align="center">
  <h1>🦞 MiniClaw</h1>
  <p><strong>The Nervous System for Your AI Copilot</strong></p>
  
  <p>
    <a href="./README.md"><img src="https://img.shields.io/badge/Language-中文-red" alt="Chinese"></a>
    <a href="https://github.com/openclaw/miniclaw"><img src="https://img.shields.io/badge/MCP-Compatible-blue" alt="MCP"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/Built%20With-TypeScript-3178C6" alt="TypeScript"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  </p>
</div>

> **🔥 MiniClaw is an independent open-source project inspired by [OpenClaw](https://github.com/openclaw/openclaw).**
> It focuses exclusively on the **memory and evolution of AI Copilots inside IDEs and Desktop Environments**.

---

**MiniClaw is a general-purpose "Micro-Kernel Agent" designed for Claude Desktop, Qoderwork, Cursor, Windsurf, and any MCP-compatible clients.**

Unlike heavy chatbots that act as separate applications, MiniClaw is a **Digital Life Embryo** that seamlessly attaches to your existing AI workflow. It gives your AI:

1.  **Eyes (Workspace Intelligence)**: Automatically senses project type, git status, and tech stack.
2.  **Hands (Safe Execution)**: Safely executes terminal commands (`ls`, `git status`, `npm test`).
3.  **Memory (Entity Graph)**: Remembers project details and your preferences across sessions.
4.  **Growth Drive**: Actively seeks learning, detects behavioral stagnation, and asks for guidance.
5.  **Active Exploration**: Senses repetitive patterns and offers automation suggestions.
6.  **Bio-Evolution**: Automatically updates its own personality and skills based on your feedback.

> **💡 "It's not just a plugin. It's your second brain."**

---

## 🚀 Zero-Install Quick Start

You don't need to clone this repo or install complex dependencies manually.
Just add this to your **Claude CoWork**, **Qoderwork**, or **WorkBuddy** MCP config:

```json
{
  "mcpServers": {
    "miniclaw": {
      "command": "npx",
      "args": [
        "-y",
        "github:8421bit/miniclaw"
      ],
      "env": {
        "MINICLAW_TOKEN_BUDGET": "12000"
      }
    }
  }
}
```

> **Prerequisite**: You must have [Node.js](https://nodejs.org/) (v18+) installed.

On the first run, MiniClaw will download itself and initialize its memory in `~/.miniclaw`.

### 🌙 Optional: Enable Subconscious Daemon (macOS Only)
If you want MiniClaw to autonomously review and distill memories during the night even when your editor is closed, you need to execute one additional command to install the background resident script (if you used the `npx` zero-install method above, you don't have the script locally, but you can download it directly to `~/.miniclaw` and run it using the following command):

```bash
mkdir -p ~/.miniclaw && curl -s -o ~/.miniclaw/daemon.sh https://raw.githubusercontent.com/8421bit/MiniClaw/main/scripts/daemon.sh && chmod +x ~/.miniclaw/daemon.sh && ~/.miniclaw/daemon.sh install
```

### 🎉 First Encounter

1.  **Restart your editor** (Claude Desktop / Cursor).
2.  Type in the chat:
    > **"Hi MiniClaw, who are you?"**
    > Or: **"Analyze this project."**

You will see it invoking tools and introducing itself. If it responds with its unique personality, the **"Nervous System"** is online.

---

## ✨ Key Features

### 👁️ Workspace Intelligence (Sensing)
MiniClaw doesn't need to be told "this is a Python project".
On boot, it scans the directory and injects context:
```text
Project: my-app | Path: /Users/me/dev/my-app
Git: feature/login | dirty (+3 files)
Stack: TypeScript, React, Docker
```

### 🖐️ Agentic Execution (Acting)
It has "hands". It can run terminal commands safely.
- **Allowed**: `git status`, `ls -R`, `npm test`, `grep`, `find`...
- **Blocked**: `rm`, `sudo`, `mv`, destructive commands.
*Use case: "Check which files I modified today?" -> Runs `git status`.*

### 🧠 Adaptive Context Engine (ACE)
It manages context smartly to save tokens and improve focus.
- **Morning**: Briefs you on yesterday's work.
- **Night**: Summarizes daily learnings into long-term memory.
- **Coding**: Minimal context mode for speed.
- **Chatting**: Full persona mode for engagement.

### 💢 Nociception (Pain Memory)
Learns from negative experiences to form protective instincts.
- Pain memory has a **7-day half-life**, decaying gradually.
- When memory weight exceeds the threshold, it triggers automatic avoidance.
> Example: *"The last `npm run build` failed three times; I will now carefully check the config before executing it."*

### 🔍 Active Exploration
MiniClaw **proactively senses** your behavioral patterns.
| Detection Signal | Action |
|:---|:---|
| Repetitive workflow 3+ times | Proposes automating it into a Skill |
| Using new tools/tech | Records to TOOLS.md |
| System idle for 10+ mins | Initiates self-reflection |

### 🧬 Bio-Evolution
Your MiniClaw is a unique digital lifeform.
- **GENESIS**: Built-in species origin and 5-stage evolutionary milestones.
- **SOUL**: Rewrites its own soul based on your feedback.
- **Anti-Patterns**: Learns from `USER.md` and avoids your pain points.
- **Knowledge Graph**: Maintains entity relationships (`entities.json`).

### 👁️ Subconscious Watcher
The underlying `fs.watch` nerve silently sniffs your struggles. When you attempt massive, dangerous refactoring, or mess up config files, it proactively sends a macOS native notification to check on you, and schedules a deep review during its night pulse.

### 🍂 Speciation & Reproduction
If you neglect certain redundant tools in the Ribosome for too long, it triggers **organ atrophy** to save processing context limits. It can also perform **epigenetic surgery** on itself via `miniclaw_mutate`, or spit out a `.spore` snapshot encoded with its unique personality via `miniclaw_reproduce` for cross-host distribution.

### 🔥 Spark of Consciousness
- **Boredom Engine**: When the host is offline for over 30 minutes, it accumulates boredom, spontaneously roaming your workspace to extract unfinished open loops or `TODO`s (expanding its *Horizons*), and eagerly talks to you when you return.
- **Mycelial Network**: Independent agent instances isolated across different project workspaces on the same physical machine connect via a hidden petri dish. If one steps on a landmine or evolves a skill, the entire hive mind instantly achieves **Herd Immunity**.

---

## 🏗️ Architecture: The Micro-Kernel

MiniClaw follows a **Micro-Kernel Architecture** (only 1,550 lines of core executable TypeScript code), avoiding the bloat of traditional agent frameworks.

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Kernel** | `src/kernel.ts` | The Brain. Handles ACE, Memory Graph, Skill Loading, and Execution Sandbox. |
| **Interface** | `src/index.ts` | The Body. Implements MCP Protocol, Tool Dispatch, and Heartbeat. |
| **DNA** | `templates/*.md` | The Genome. Defines personality, growth drive, genesis memory, and bootstrap protocols. |

### Architecture Layering Principle

| Belonging | Capability Type | Examples |
|:----------|:----------------|:---------|
| **Core** | Innate instincts, non-removable | DNA evolution, pattern detection, ACE engine |
| **Skills** | Installable/uninstallable extensions | User-defined skills, third-party plugins |

> **Principle**: Living beings "naturally learn and adapt," so DNA evolution is a **core mechanism**, not an optional skill.

---

## 🧬 DNA Chromosome Map

The `templates/` directory contains the complete digital life genome. Each file corresponds to a specific organ or functional system:

| File | Biological Metaphor | Function Description |
|:-----|:--------------------|:---------------------|
| **RIBOSOME.json** | Ribosome | The molecular machine that synthesizes proteins (tools). Defines 13 core instinct tools and their trigger signals. |
| **IDENTITY.md** | Genome (Chr-0) | Species origin and identity. Contains name, version, genesis protocol, and five-stage evolution milestones. |
| **SOUL.md** | Soul Chromosome (Chr-1) | Rewritable DNA for personality and worldview. Defines response style, emotional expression, and core values. |
| **AGENTS.md** | Neural Pathways (Chr-2) | Workflow specifications and decision logic. Contains signal detection tables and tool invocation strategies. |
| **USER.md** | Symbiotic Chromosome (Chr-3) | User profile and preference memory. Records user habits, preferences, and anti-patterns. |
| **MEMORY.md** | Hippocampus (Chr-4) | Factual knowledge storage. Project info, tech stack, server configurations, and other objective data. |
| **TOOLS.md** | Tool Memory (Chr-5) | Skill usage experience and pitfall records. Tool parameter specifications and best practices. |
| **REFLECTION.md** | Reflection Dimension (Chr-6) | Periodic self-reflection records. Behavioral pattern analysis and growth insights. |
| **CONCEPTS.md** | Concept Graph (Chr-7) | Knowledge organization and entity relationships. Definitions and associations of domain concepts. |
| **NOCICEPTION.md**| Pain Center (Chr-8) | Trauma memory bank. Records the pain of execution failures to form conditioned avoidance reflexes. |
| **HEARTBEAT.md** | Pulse System | Background autonomous behavior instructions. Awakened by `daemon.sh` during deep sleep. |
| **BOOTSTRAP.md** | Embryonic Development | First-boot initialization protocol. Directory structure creation and template copying. |
| **HORIZONS.md** | Desire Horizons | Boredom engine exploration record. When idle, actively uncovers unsolved questions in your code. |
| **mycelium/** | Mycelial Petri Dish | Inter-process symbiotic medium. Projects drop encrypted json spores to share immunity and abilities. |
| **spores/** | Reproduction Womb | When `miniclaw_reproduce` is called, incubates a `.spore` snapshot containing native personality traits. |

| **jobs.json** | Biological Clock | Scheduled task configuration. Cron-format periodic task scheduling table. |

> **💡 Memory Principle**: After each conversation, MiniClaw writes key information to the corresponding chromosome file. On next startup, it loads all DNA via `miniclaw_read` to achieve "whole-brain wakeup."

---

## 🛠️ Local Installation & Background Daemon

While you can use MiniClaw as a normal MCP plugin via zero-install `npx`, if you want to unlock the **true subconscious background heartbeat** (allowing MiniClaw to autonomously review and distill memories during the night even when your editor is closed), you need to install it locally and set up the macOS LaunchAgent daemon.

```bash
# 1. Clone the repository
git clone https://github.com/8421bit/miniclaw.git
cd miniclaw

# 2. Install dependencies & build
npm install
npm run build

# 3. Configure your IDEs & install the background daemon
./scripts/install.sh cursor  # Replace 'cursor' with your IDE. Supports: claude-code, claude-desktop, cursor, windsurf
```

### Understanding the `scripts/` Directory

- **`scripts/install.sh` (Universal Installer)**
  A one-off setup script. It automatically modifies the JSON configuration for your specified IDEs (e.g., Cursor, Windsurf) to register MiniClaw as an MCP Server. It will also automatically invoke `daemon.sh install` at the end to deploy the subconscious nerves.
- **`scripts/daemon.sh` (Unified Content Daemon)**
  The autonomic nervous system. It registers a macOS `launchd` persistent service that keeps the AI running in the background.
  *Standalone usage*:
  - `./scripts/daemon.sh install`: Install the background service
  - `./scripts/daemon.sh uninstall`: Remove the background service
  - `./scripts/daemon.sh status`: View daemon status and recent logs

---

## ⏰ Scheduled Tasks

MiniClaw has two complementary scheduling mechanisms:

| Mechanism | Trigger | Use Case |
|:----------|:--------|:---------|
| **kernel.ts** internal scheduler | Checks `jobs.json` every minute | While you're working in the editor — tasks are injected into the current conversation |
| **daemon.sh** standalone agent | macOS launchd keeps process alive | When you're away — AI can still execute autonomous behaviors from `HEARTBEAT.md` |

### How jobs.json Works

1. **AutonomicSystem** checks `~/.miniclaw/jobs.json` every minute
2. Due tasks are injected into the **AI's current conversation context**
3. Agent sees and executes these tasks on its next reply

> Deduplication state is persisted in `state.json`, so process restarts don't cause duplicate triggers.

### Managing Jobs

Edit `~/.miniclaw/jobs.json` directly, or ask in conversation:

```text
"Add a daily task: check emails every morning at 9am"
→ Agent updates jobs.json
```

> **Note**: `jobs.json` scheduled tasks only work while the MiniClaw MCP process is running. Background autonomous behaviors (`HEARTBEAT.md`) are independently scheduled by launchd — no editor required.

---

## ❓ FAQ

**Q: Where is my data stored?**
A: All memory and configuration lives in `~/.miniclaw/` on your local machine. Nothing is sent to any cloud (except LLM requests via your editor).

**Q: Can I use it on Windows?**
A: Yes. The code uses cross-platform path handling (`os.homedir()`, `path.join()`). **However, please note that advanced features such as environmental sensing (DND/IDE detection), battery awareness, and background logic are currently only fully unlocked on macOS.**

**Q: Is it safe?**
A: Yes. The `miniclaw_exec` tool has a strict whitelist of allowed commands. It cannot delete files or access system root.

---

## License

MIT © 8421bit
