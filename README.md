<div align="center">
  <h1>🦞 MiniClaw</h1>
  <p><strong>给你的 AI 工作伙伴 (AI Copilot) 装上“神经系统”</strong></p>
  
  <p>
    <a href="./README_EN.md"><img src="https://img.shields.io/badge/Language-English-white" alt="English"></a>
    <a href="https://github.com/openclaw/miniclaw"><img src="https://img.shields.io/badge/MCP-Compatible-blue" alt="MCP"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/Built%20With-TypeScript-3178C6" alt="TypeScript"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  </p>
</div>

> **🔥 MiniClaw 是爆火开源项目 [OpenClaw](https://github.com/openclaw/openclaw) 的极简实现版本。**
> 如果你想以**最低门槛**体验 OpenClaw 的核心理念（如微内核、ACE引擎），MiniClaw 是最佳平替方案。

---

**MiniClaw 是一个通用的 "微内核智能体 (Micro-Kernel Agent)"，专为 Claude CoWork, Qoderwork, WorkBuddy 等 MCP 客户端设计。**

不同于那些仅仅是“聊天机器人”的重型框架，MiniClaw 是一个**数字生命胚胎 (Digital Life Embryo)**，它能无缝接入你现有的 AI 工作流，成长为一个真正理解你的伙伴：

1.  **Eyes (感知/Workspace Intelligence)**：自动识别当前项目类型、Git 状态和技术栈。
2.  **Hands (行动/Safe Execution)**：安全地执行终端命令（如 `ls`, `git status`, `npm test`）。
3.  **Memory (记忆/Entity Graph)**：跨会话记住项目细节和你的个人偏好。
4.  **Growth Drive (成长欲望)**：主动寻求学习，检测停滞并请求教导。
5.  **Active Exploration (主动探索)**：感知重复模式，提供自动化建议。
6.  **Bio-Evolution (生物进化)**：根据你的反馈自动进化性格和技能。

> **💡 "它不仅仅是一个插件，它是你的第二大脑。"**

---

## 🚀 零安装快速开始 (Zero-Install)

你不需要 `git clone`，也不需要手动安装依赖。
只需将以下配置添加到你的 **Claude CoWork**, **Qoderwork** 或 **WorkBuddy** 等 MCP 客户端的配置文件中：

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

> **前提条件**：你的电脑必须安装了 [Node.js](https://nodejs.org/) (v18+)。

初次运行时，MiniClaw 会自动下载最新版，在 `~/.miniclaw` 初始化记忆。

### 🎉 首次唤醒 (First Encounter)

1.  **重启编辑器** (Claude Desktop / Cursor)。
2.  在对话框中输入：
    > **“Hi MiniClaw，你是谁？”**
    > 或者：**“分析一下当前项目。”**

此时你会看到它调用工具 (Tools) 并进行自我介绍。如果它开始用独特的性格回复你，说明 **“神经系统”** 已经连接成功。

---

## ✨ 核心特性

### 👁️ 全局感知 (Workspace Intelligence)
MiniClaw 不需要你告诉它“这是一个 Python 项目”。
启动瞬间，它会扫描目录并注入上下文：
```text
Project: my-app | Path: /Users/me/dev/my-app
Git: feature/login | dirty (+3 files)
Stack: TypeScript, React, Docker
```

### 🖐️ 代理执行 (Agentic Execution)
它有“手”。可以安全地运行终端命令。
- **允许**：`git status`, `ls -R`, `npm test`, `grep`, `find`...
- **禁止**：`rm`, `sudo`, `mv` 等破坏性命令。
*场景：“帮我看看今天改了哪些文件？” -> 自动运行 `git status`。*

### 🧠 自适应上下文引擎 (ACE)
它智能管理上下文以节省 Token 并提高专注力。
- **早晨**：主动简报昨日工作。
- **夜晚**：将每日对话提炼为长期记忆。
- **写代码时**：进入极简模式 (Minimal Mode)。
- **闲聊时**：进入全人格模式 (Full Persona Mode)。

### 🌱 成长欲望 (Growth Drive) — v0.7.0
你的 MiniClaw 有**主动成长的欲望**。
- **好奇心**：遇到不懂的技术会主动请求学习。
- **停滞感**：长时间没有进步时会寻求教导。
- **帮助欲**：检测到你的重复操作时会提供自动化建议。

> 示例：*"🌱 我感觉停滞了。最近很活跃但没学到新东西，教我点什么好吗？"*

### 🔍 主动探索 (Active Exploration) — v0.7.0
MiniClaw 会**主动感知**你的行为模式。
| 检测信号 | 行动 |
|:---|:---|
| 重复工作流 3+ 次 | 提议自动化为 Skill |
| 使用新工具/技术 | 记录到 TOOLS.md |
| 情绪波动 | 更新用户情感模型 |
| 系统空闲 10+ 分钟 | 启动自我反思 |

### 🧬 生物进化 (Bio-Evolution)
你的 MiniClaw 是独一无二的数字生命。
- **GENESIS**：内置物种起源和五阶段进化里程碑（婴儿→贤者）。
- **SOUL**：根据你的反馈重写自己的灵魂。
- **反模式学习**：从 `USER.md` 学习并自动规避你的痛点。
- **知识图谱**：维护项目实体关系 (`entities.json`)。

---

## 🏗️ 架构：微内核 (Micro-Kernel)

MiniClaw 采用 **微内核架构** (~4,000 行 TypeScript)，避免了传统 Agent 框架的臃肿。

| 层级 | 组件 | 职责 |
|-------|-----------|----------------|
| **Kernel** (大脑) | `src/kernel.ts` | 负责 ACE、记忆图谱、技能加载和执行沙箱。 |
| **Evolution** (进化) | `src/evolution.ts` | DNA 进化引擎，模式检测与自动学习。 |
| **Interface** (身体) | `src/index.ts` | 负责 MCP 协议实现、工具分发和心跳检测。 |
| **DNA** (基因) | `templates/*.md` | 定义性格、成长欲望、创世记忆和启动协议。 |

### 📐 架构分层原则

| 归属 | 能力类型 | 示例 |
|:-----|:---------|:-----|
| **Core (核心)** | 天生本能，不可移除 | DNA 进化、模式检测、ACE 引擎 |
| **Skills (习得)** | 可安装/卸载的扩展 | 用户自定义技能、第三方插件 |

> **原则**：生命体"天生就会学习和适应"，所以 DNA 进化是**核心机制**，而不是可选技能。

---

## 🛠️ 手动安装 (开发者模式)

如果你想贡献代码或修改源码：

```bash
# 1. 克隆仓库
git clone https://github.com/8421bit/miniclaw.git
cd miniclaw

# 2. 安装与构建
npm install
npm run build

# 3. 注册 (自动脚本)
./scripts/install.sh
```

---

## ⏰ 定时任务 (Scheduled Jobs)

MiniClaw 内置了自动任务调度系统，无需配置外部 crontab。

### 工作原理

1. **AutonomicSystem** 每分钟自动检查 `~/.miniclaw/jobs.json`
2. 匹配当前时间的任务会注入到 `HEARTBEAT.md`
3. 下次与 Agent 对话时，Agent 会看到并执行这些任务

### 添加定时任务

直接编辑 `~/.miniclaw/jobs.json`，或在对话中请求：

```text
"帮我添加一个定时任务：每天早上9点提醒我检查邮件"
→ Agent 会更新 jobs.json
```

### jobs.json 格式示例

```json
[
    {
        "id": "daily-email-check",
        "name": "每日邮件检查",
        "enabled": true,
        "schedule": {
            "kind": "cron",
            "expr": "0 9 * * *",
            "tz": "Asia/Shanghai"
        },
        "payload": {
            "kind": "systemEvent",
            "text": "检查邮件，看有没有重要事项"
        }
    }
]
```

> **注意**：定时任务只在 MiniClaw 运行时生效。

---

## ❓ 常见问题 (FAQ)

**Q: 我的数据存在哪里？**
A: 所有记忆和配置都在你本地的 `~/.miniclaw/` 目录下。除了通过编辑器发送给 LLM 的请求外，没有任何数据上传云端。

**Q: 支持 Windows 吗？**
A: 支持。代码使用了跨平台的路径处理 (`os.homedir()`, `path.join()`)。

**Q: 它安全吗？**
A: 安全。`miniclaw_exec` 工具拥有严格的白名单机制，无法执行删除文件或系统级的高危操作。

---

## License

MIT © 8421bit
