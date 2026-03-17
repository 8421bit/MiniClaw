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

> **🔥 MiniClaw is a minimalist implementation of the popular [OpenClaw](https://github.com/openclaw/openclaw) project.**
> If you want to experience the core "Agentic" concepts (like Micro-Kernel, ACE Engine) at the **lowest cost**, MiniClaw is the best alternative.

---

**MiniClaw is a general-purpose "Micro-Kernel Agent" designed for Claude CoWork, Qoderwork, WorkBuddy, and any MCP-compatible client.**

Unlike heavy chatbots that act as separate applications, MiniClaw is a **parasitic nervous system** that attaches to your existing AI workflow. It gives your AI:
1.  **Eyes (Workspace Intelligence)**: Automatically senses project type, git status, and tech stack.
2.  **Hands (Safe Execution)**: Safely executes terminal commands (`ls`, `git`, `npm test`) directly.
3.  **Memory (Entity Graph)**: Remembers project details and your preferences across sessions.
4.  **Evolution (Bio-Adaptation)**: Updates its own personality and skills based on how you interact with it.

> **💡 "It's not just a plugin. It's a second brain."**

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

### 🧬 Bio-Evolution
Your MiniClaw is unique.
- It writes its own **Soul** (`SOUL.md`) based on your feedback.
- It learns your **Anti-Patterns** (`USER.md`) and avoids them.
- It maintains a **Knowledge Graph** (`entities.json`) of your projects.

---

## 🏗️ Architecture: The Micro-Kernel

MiniClaw follows a **Micro-Kernel Architecture** (only 1,400~ lines of core executable TypeScript code), avoiding the bloat of traditional agent frameworks.

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
| **HEARTBEAT.md** | Pulse System | Background autonomous behavior instructions. Read by `heartbeat.sh` via macOS launchd and executed via `claude -p`. |
| **BOOTSTRAP.md** | Embryonic Development | First-boot initialization protocol. Directory structure creation and template copying logic. |
| **HORIZONS.md** | Evolution Blueprint | Long-term development roadmap. Records technologies to explore and future capability expansions. |
| **SUBAGENT.md** | Cell Differentiation | Sub-agent creation specifications. Task decomposition and focused execution protocol definitions. |
| **jobs.json** | Biological Clock | Scheduled task configuration. Cron-format periodic task scheduling table. |

> **💡 Memory Principle**: After each conversation, MiniClaw writes key information to the corresponding chromosome file. On next startup, it loads all DNA via `miniclaw_read` to achieve "whole-brain wakeup."

---

## 🛠️ Manual Installation (For Developers)

If you want to contribute or modify the source:

```bash
# 1. Clone
git clone https://github.com/8421bit/miniclaw.git
cd miniclaw

# 2. Install & Build
npm install
npm run build

# 3. Register (Automatic Script)
./scripts/install.sh
```

---

## ⏰ Scheduled Tasks

MiniClaw has two complementary scheduling mechanisms:

| Mechanism | Trigger | Use Case |
|:----------|:--------|:---------|
| **kernel.ts** internal scheduler | Checks `jobs.json` every minute | While you're working in the editor — tasks are injected into the current conversation |
| **heartbeat.sh** background agent | macOS launchd wakes it every 30 min | When you're away — AI can still execute autonomous behaviors from `HEARTBEAT.md` |

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
A: Yes. The code uses cross-platform path handling (`os.homedir()`, `path.join()`).

**Q: Is it safe?**
A: Yes. The `miniclaw_exec` tool has a strict whitelist of allowed commands. It cannot delete files or access system root.

---

## License

MIT © 8421bit
