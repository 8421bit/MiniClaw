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
Just add this to your **Claude Desktop**, **Qoderwork**, or **OpenClaw** MCP config:

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

MiniClaw follows a **Micro-Kernel Architecture** (~2,700 LOC), avoiding the bloat of traditional agent frameworks.

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Kernel** | `src/kernel.ts` | The Brain. Handles ACE, Memory Graph, Skill Loading, and Execution Sandbox. |
| **Interface** | `src/index.ts` | The Body. Implements MCP Protocol, Tool Dispatch, and Heartbeat. |
| **DNA** | `templates/*.md` | The Personality. Definable traits for Identity, Constitution, and Bootstrap. |

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
