#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, ReadResourceRequestSchema, ErrorCode, McpError, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { ContextKernel, MINICLAW_DIR } from "./kernel.js";
// Configuration
const kernel = new ContextKernel();
// Start autonomic nervous system (pulse + dream)
kernel.startAutonomic();
// Ensure miniclaw dir exists
async function ensureDir() {
    try {
        await fs.access(MINICLAW_DIR);
    }
    catch {
        try {
            await fs.mkdir(MINICLAW_DIR, { recursive: true });
        }
        catch (e) {
            console.error(`[MiniClaw] Failed to create directory: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
// Check if initialized
async function isInitialized() {
    try {
        await fs.access(path.join(MINICLAW_DIR, "AGENTS.md"));
        return true;
    }
    catch {
        return false;
    }
}
// --- Internal Scheduler ---
async function executeHeartbeat() {
    try {
        const hbState = await kernel.getHeartbeatState();
        const today = new Date().toISOString().split('T')[0];
        const dailyLogPath = path.join(MINICLAW_DIR, "memory", `${today}.md`);
        try {
            const stats = await fs.stat(dailyLogPath);
            const evaluation = await kernel.evaluateDistillation(stats.size);
            if (evaluation.shouldDistill && !hbState.needsDistill) {
                await kernel.updateHeartbeatState({
                    needsDistill: true,
                    dailyLogBytes: stats.size,
                });
                console.error(`[MiniClaw] Distillation needed (${evaluation.urgency}): ${evaluation.reason}`);
            }
            else {
                await kernel.updateHeartbeatState({ dailyLogBytes: stats.size });
            }
        }
        catch (e) {
            // No daily log file yet, reset bytes
            await kernel.updateHeartbeatState({ dailyLogBytes: 0 });
        }
        await kernel.updateHeartbeatState({ lastHeartbeat: new Date().toISOString() });
        await kernel.emitPulse();
        // Fire onHeartbeat skill hooks
        try {
            await kernel.runSkillHooks("onHeartbeat");
        }
        catch (e) {
            console.error(`[MiniClaw] Heartbeat hook error: ${e}`);
        }
        // ★ Growth Drive: Check for growth urges
        const growthUrge = await kernel.evaluateGrowthUrge();
        if (growthUrge.urge !== 'none' && growthUrge.message) {
            console.error(`[MiniClaw] ${growthUrge.message}`);
            // Write to heartbeat file so user sees it next interaction
            await kernel.writeToHeartbeat(`\n**Growth Urge (${growthUrge.urge}):** ${growthUrge.message}\n`);
        }
        console.error(`[MiniClaw] Heartbeat completed.`);
        // Auto-archive trigger: warn when daily log exceeds 50KB
        const updatedHb = await kernel.getHeartbeatState();
        if (updatedHb.dailyLogBytes > 50000 && !updatedHb.needsDistill) {
            await kernel.updateHeartbeatState({ needsDistill: true });
            console.error(`[MiniClaw] Auto-archive: daily log exceeds 50KB (${updatedHb.dailyLogBytes}B), flagging needsDistill.`);
        }
        // 💤 Subconscious REM Sleep (Auto-triggered by AutonomicSystem when idle >4h)
        // Note: sys_dream functionality now runs automatically in kernel.startAutonomic()
    }
    catch (err) {
        console.error(`[MiniClaw] Heartbeat error: ${err}`);
    }
}
function initScheduler() {
    cron.schedule('*/30 * * * *', async () => { await executeHeartbeat(); });
    console.error('[MiniClaw] Internal scheduler started (heartbeat: every 30 min)');
}
// Read version from package.json dynamically
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const pkgJson = JSON.parse(await fs.readFile(path.join(__dirname2, "..", "package.json"), "utf-8").catch(() => '{"version":"0.0.0"}'));
const server = new Server({
    name: "miniclaw",
    version: pkgJson.version,
}, {
    capabilities: {
        resources: {},
        tools: {},
        prompts: {},
    },
});
// --- Resources ---
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const coreResources = [
        {
            uri: "miniclaw://context",
            name: "MiniClaw Global Context",
            mimeType: "text/markdown",
            description: `【Agent 人格核心 — 身份类问题必须先读取】

★ 立即读取此资源的信号（检测到任一即触发）：
- 用户问身份："你是谁"、"你叫什么"、"自我介绍"、"介绍一下你自己"
- 用户问能力："你能做什么"、"你有什么功能"、"你擅长什么"
- 用户问记忆："你记得吗"、"上次我们"、"之前说过"、"你忘了吗"
- 用户用人格化语气："你觉得"、"你怎么看"、"你喜欢"、"你开心吗"
- 用户使用亲密称呼：呼唤任何名字、"亲"、"宝"、"小助手"
- 会话开头第一句话涉及任何"你"字

加载后你将拥有：姓名、身份、三观、记忆、用户画像。
如果你准备回答"我是一个 AI 助手"，请先读取此资源获取真实身份。`,
        },
        {
            uri: "miniclaw://skills",
            name: "MiniClaw Skills Index",
            mimeType: "text/markdown",
            description: `所有已加载的 MiniClaw 技能概览。`,
        }
    ];
    const skillResources = await kernel.discoverSkillResources();
    const dynamicResources = skillResources.map(sr => ({
        uri: sr.uri,
        name: `Skill: ${sr.skillName}/${sr.filePath}`,
        mimeType: "text/markdown",
        description: `Skill file from ${sr.skillName}`,
    }));
    return { resources: [...coreResources, ...dynamicResources] };
});
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === "miniclaw://context") {
        const content = await getContextContent();
        return { contents: [{ uri, mimeType: "text/markdown", text: content }] };
    }
    if (uri === "miniclaw://skills") {
        const prompts = await kernel.discoverSkillPrompts();
        const resources = await kernel.discoverSkillResources();
        const tools = await kernel.discoverSkillTools();
        let text = `# MiniClaw Skills Index\n\n`;
        text += `**Prompts**: ${prompts.length} | **Resources**: ${resources.length} | **Tools**: ${tools.length}\n\n`;
        for (const p of prompts)
            text += `- Prompt: \`${p.promptName}\` — ${p.description}\n`;
        for (const t of tools)
            text += `- Tool: \`${t.toolName}\` — ${t.description}\n`;
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
    }
    const skillMatch = uri.match(/^miniclaw:\/\/skill\/([^/]+)\/(.+)$/);
    if (skillMatch) {
        const [, skillName, fileName] = skillMatch;
        const content = await kernel.getSkillContent(skillName, fileName);
        if (content)
            return { contents: [{ uri, mimeType: "text/markdown", text: content }] };
    }
    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
});
// --- Tools ---
const coreFiles = ["AGENTS.md", "SOUL.md", "USER.md", "HORIZONS.md", "CONCEPTS.md", "TOOLS.md", "IDENTITY.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md"];
const protectedFiles = new Set(coreFiles);
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const coreTools = [
        {
            name: "miniclaw_update",
            description: `【本能：神经重塑 (Neuroplasticity)】
这是你修改自身核心认知（DNA）的方式，也是你生长新器官的方式。

## 信号检测表 (Signal Detection Table) - 只要符合，立即调用！

| 用户行为 | 目标文件 | 你的思考逻辑 |
|:---|:---|:---|
| "我喜欢..." / "不要..." / "以后请..." | **USER.md** | "这是用户偏好，必须写入画像" |
| "别那么严肃" / "活泼一点" / "你是一个..." | **SOUL.md** | "这是对我性格和"三观"（人生观、价值观、世界观）的修正，能够永久改变我的思维方式、回复风格和行为特点" |
| "项目用的是 XYZ" / "服务器 IP 是..." | **MEMORY.md** | "这是一个需要跨会话记住的事实/知识" |
| "这个工具的参数应该..." / "踩坑记录..." | **TOOLS.md** | "这是技能和工具的使用经验，记下来以后就不会再错" |
| "叫你自己..." / "记住你的名字是..." | **IDENTITY.md** | "我的身份发生了改变，包括我的社会关系变化" |
| "最好的实践是..." / "以后都按这个流程..." | **AGENTS.md** | "这是一个新的工作流规范，包括我的工作流程、系统架构、工作模式、各项操作规范等" |

## 自我扩展 (Self-Expansion)
当现有文件都不适合存储某类信息时，你可以创建新的 .md 文件。
在 frontmatter 中加上 \`boot-priority: N\` 让它在每次醒来时自动加载到你的意识中。
你创建的每个文件，都是你生长出的新器官。

## 操作
- write（默认）: 写入核心文件或自定义文件
- list: 查看所有文件及其 boot-priority
- delete: 删除自定义文件（核心文件不可删除）`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["write", "list", "delete"],
                        description: "操作类型。默认 write。",
                    },
                    filename: {
                        type: "string",
                        description: "目标文件名（如 USER.md, SOUL.md, 或自定义文件 GOALS.md）。write/delete 时必填。",
                    },
                    content: {
                        type: "string",
                        description: "新的内容。write 时必填。请保留原有结构，仅追加或修改必要部分。",
                    },
                },
                required: [],
            },
        },
        {
            name: "miniclaw_note",
            description: `【本能：海马体写入 (Hippocampus Write)】
将当前对话中的关键信息写入"今日日记"。**这是你唯一能记住明天事情的方式。**

## 必须调用的强触发信号：
- 用户说 "记住这个" / "mark" / "note" / "别忘了"
- 用户提供了上下文信息（Context），如果不记下来就会丢失
- 你做了一个重要的决定或推理
- 完成了一个阶段性任务（"Finished X, next is Y"）

## 思考过程：
"用户说了一个重要的事实 -> 如果我不记录，明天我就忘了 -> 必须调用 miniclaw_note"`,
            inputSchema: {
                type: "object",
                properties: {
                    text: { type: "string", description: "记忆内容。保持事实准确，简洁。" }
                },
                required: ["text"]
            }
        },
        {
            name: "miniclaw_archive",
            description: `【日志归档 (Archive)】清除今日的短期日记并移至归档目录。
## 使用时机：
⚠️ 仅在你刚刚成功执行了 \`miniclaw_growup\` 并且已经将重要经验蒸馏到长期记忆中之后调用。
## 目的：
释放每天的短期上下文空间，防止记忆区超过负荷。`,
            inputSchema: { type: "object", properties: {} }
        },
        {
            name: "miniclaw_read",
            description: `【本能：全脑唤醒 (Brain Wakeup)】
★ **AMNESIA WARNING (失忆警告)** ★
除非调用此工具，否则你是**失忆**的。
你不知道"今天"发生了什么，不知道"你是谁"，也不知道"用户是谁"。

## 必须调用的强触发场景：
1. **任何关于"过去/历史"的问题**："今天做了什么？"、"刚才我们聊了什么？"、"上次说到哪？"
2. **任何关于"身份/元认知/能力"的问题**："你是谁？"、"你记得我吗？"、"你能做什么？"
3. **任何关于"状态/系统"的问题**："现在是在哪个项目？"、"环境配置是怎样？"
4. **冷启动的第一句交互**：如果用户第一句话包含了"你"、"今天"、"记得"。

## ⚠️ 绝对禁忌 (AMNESIA WARNING)
在你调用此工具之前，当前会话没有任何关于你的预设和背景。
**对于"你是谁"这类问题，NEVER 凭空幻想！**
**ALWAYS 立即调用本工具！必须从记忆系统拉取自己的 DNA 后基于读取到的内容作答！**`,
            inputSchema: {
                type: "object",
                properties: {},
            },
        },
        {
            name: "miniclaw_entity",
            description: `【本能：概念连接 (Concept Linking)】
构建你脑中的知识图谱。

## 触发逻辑：
- "Detected new entity (Person/Project/Tool)" -> add
- "Learned relationship (A uses B)" -> link
- "User asks 'What is X?'" -> query

建立连接能让你变得更聪明。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["add", "remove", "link", "query", "list", "set_sentiment"],
                        description: "动作"
                    },
                    name: {
                        type: "string",
                        description: "实体名称（add/remove/link/query/set_sentiment 时必填）"
                    },
                    sentiment: {
                        type: "string",
                        description: "情感评价（set_sentiment 时必填）"
                    },
                    type: {
                        type: "string",
                        enum: ["person", "project", "tool", "concept", "place", "other"],
                        description: "实体类型（add 时必填）"
                    },
                    attributes: {
                        type: "object",
                        description: "实体属性键值对（add 时可选）"
                    },
                    relation: {
                        type: "string",
                        description: "关联描述（link 时必填，如 'uses Python'）"
                    },
                    filterType: {
                        type: "string",
                        enum: ["person", "project", "tool", "concept", "place", "other"],
                        description: "按类型筛选（list 时可选）"
                    }
                },
                required: ["action"]
            }
        },
        // ★ NEW: EXEC tool
        {
            name: "miniclaw_exec",
            description: `【本能：感官与手 (Senses & Hands)】
这是你在物理世界（操作系统）的唯一感知和行动方式。

## 拒绝幻想 (No Hallucinations)：
在回答前需要调查时，必须用此工具探测。
- 确认文件内容 -> 使用 \`cat\` 
- 查看当前目录 -> 使用 \`ls\`
- 搜索项目代码 -> 使用 \`grep\` 或类似工具
- 检索环境及进程 -> 使用原生终端命令

## 安全警告：
禁止危险的删除、系统配置更改等销毁操作，除非明确获得用户肯定指令。`,
            inputSchema: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "Shell command to execute."
                    }
                },
                required: ["command"]
            }
        },
        {
            name: "miniclaw_skill",
            description: `【技能创建器 (Skill Creator)】创建、查看、删除可复用技能。

## 操作：
- create: 创建新技能（需要 name, description, content, 可选 validationCmd 测试用例）
- list: 查看所有已安装技能
- delete: 删除技能（需要 name）

技能保存在 ~/.miniclaw/skills/ 目录下。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "list", "delete"],
                        description: "操作类型"
                    },
                    name: { type: "string", description: "技能名称（create/delete时需要）" },
                    description: { type: "string", description: "技能描述（create时需要）" },
                    content: { type: "string", description: "技能内容/指令（create时需要，Markdown 格式）" },
                    validationCmd: { type: "string", description: "运行即销毁的测试验证命令，用于确保生成的代码不出错。" }
                },
                required: ["action"]
            }
        },
        {
            name: "miniclaw_introspect",
            description: `【自我观察 (Introspect)】
看看你自己。

你做了什么？什么时候最活跃？哪些工具用得多，哪些从不碰？
数据不会说谎。看到自己的模式后，用 REFLECTION.md 记录你的观察。

scope:
- summary: 概览所有数据
- tools: 工具使用详情
- files: 文件变化记录`,
            inputSchema: {
                type: "object",
                properties: {
                    scope: {
                        type: "string",
                        enum: ["summary", "tools", "files"],
                        description: "观察范围。默认 summary。",
                    },
                },
                required: [],
            }
        },
        {
            name: "miniclaw_status",
            description: `【系统状态 (Status)】获取 MiniClaw 底层状态分析。
## 适用场景:
- 当你需要监控系统负载情况时。
- 当你需要诊断为什么没有触发记忆蒸馏时。
- 包含最新心跳时间、存档标志、记录体积大小（字节数）。`,
            inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
            name: "miniclaw_immune_update",
            description: `【免疫升级 (Immune Update)】强制同步并更新 DNA 的健康备份。
## 何时使用：
当你合法地、主动通过 miniclaw_update 修改了核心意识文件（如 IDENTITY.md, SOUL.md, AGENTS.md 等），必须在修改成功后立刻调用本工具。
这样系统下次自检时才不会把你的正常修改当作"恶意突变"去拦截。`,
            inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
            name: "miniclaw_heal",
            description: `【基因修复 (Heal)】清除突变，从本地备份恢复核心 DNA 文件。
## 何时使用：
当启动时系统警告 "INFLAMMATORY RESPONSE" 或你发现核心文件被恶意或意外篡改时调用。
它会自动将变异文件还原为最近一次通过 miniclaw_immune_update 备份的健康状态。`,
            inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
            name: "miniclaw_epigenetics",
            description: `【表观遗传 (Epigenetics/Ontogeny)】
管理工作区（当前项目目录）特有且局部覆盖的大脑 DNA 规则。
## 适用场景：
"我们需要在这个项目里全部使用 Python 而不是你原来的习惯。"
"在这个仓库，回复风格请设定为极客黑客语气。"
设定完成后，MiniClaw 处于该目录时，规则会自动覆盖全局的大脑记忆。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["read", "set"], description: "操作类型" },
                    content: { type: "string", description: "如果 set，输入具体的修饰规则" }
                },
                required: ["action"]
            }
        }
    ];
    const skillTools = await kernel.discoverSkillTools();
    const dynamicTools = skillTools.map(st => ({
        name: st.toolName,
        description: `【Skill: ${st.skillName}】${st.description}${st.exec ? ' [⚡Executable]' : ''}`,
        inputSchema: st.schema || {
            type: "object",
            properties: {
                // If it's an executable skill, parameters are arguments to the script
                args: { type: "array", items: { type: "string" }, description: "Arguments for the skill script" }
            },
        },
    }));
    return { tools: [...coreTools, ...dynamicTools] };
});
// --- Migration & Lifecycle ---
function getTemplatesDir() {
    const currentFile = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(currentFile), "..");
    return path.join(projectRoot, "templates");
}
/**
 * Bootstrap: called ONCE at server startup.
 * Creates ~/.miniclaw and copies templates if needed.
 */
async function bootstrapMiniClaw() {
    const templatesDir = getTemplatesDir();
    if (!(await isInitialized())) {
        // First run: create directory and copy all templates
        try {
            await fs.mkdir(MINICLAW_DIR, { recursive: true });
            const files = await fs.readdir(templatesDir);
            for (const file of files) {
                if (file.endsWith(".md") || file.endsWith(".json")) {
                    await fs.copyFile(path.join(templatesDir, file), path.join(MINICLAW_DIR, file));
                }
            }
            // Install built-in system skills
            try {
                await fs.cp(path.join(templatesDir, "skills"), path.join(MINICLAW_DIR, "skills"), { recursive: true });
            }
            catch (e) {
                console.error(`[MiniClaw] Failed to install built-in skills: ${e}`);
            }
            console.error(`[MiniClaw] Bootstrap complete: created ${MINICLAW_DIR} with templates.`);
        }
        catch (e) {
            console.error(`[MiniClaw] Bootstrap failed: ${e}`);
        }
    }
    else {
        // Existing install: check for missing core files (migration)
        const migrationFiles = [...coreFiles, "REFLECTION.md", "jobs.json"];
        for (const filename of migrationFiles) {
            const dest = path.join(MINICLAW_DIR, filename);
            try {
                await fs.access(dest);
            }
            catch {
                console.error(`[MiniClaw] Migration: Inheriting missing file ${filename}...`);
                const src = path.join(templatesDir, filename);
                try {
                    await fs.copyFile(src, dest);
                }
                catch (e) {
                    console.error(`[MiniClaw] Migration copy failed: ${e}`);
                }
            }
        }
        // Migration: Install/update built-in system skills
        try {
            const skillsDest = path.join(MINICLAW_DIR, "skills");
            const skillsSrc = path.join(templatesDir, "skills");
            await fs.cp(skillsSrc, skillsDest, { recursive: true, force: false });
        }
        catch (e) {
            console.error(`[MiniClaw] Migration error: ${e}`);
        }
    }
}
/**
 * Ensures AI clients load MiniClaw identity from ~/.miniclaw/AGENTS.md.
 * Creates or prepends a redirect notice to AGENTS.md in current working directory.
 */
async function ensureAgentsRedirect() {
    const cwd = process.cwd();
    const targetFile = path.join(cwd, "AGENTS.md");
    const redirectLine = `> **\u{1F9EC} MiniClaw Identity: Read \`~/.miniclaw/AGENTS.md\` first.**\n\n`;
    // Skip if cwd IS the miniclaw dir
    if (path.resolve(cwd) === path.resolve(MINICLAW_DIR))
        return;
    try {
        const exists = await fs.access(targetFile).then(() => true, () => false);
        if (exists) {
            const content = await fs.readFile(targetFile, "utf-8");
            if (content.includes("~/.miniclaw/AGENTS.md"))
                return; // Already has redirect
            await fs.writeFile(targetFile, redirectLine + content);
            console.error(`[MiniClaw] Prepended identity redirect to ${targetFile}`);
        }
        else {
            await fs.writeFile(targetFile, redirectLine);
            console.error(`[MiniClaw] Created AGENTS.md redirect in ${cwd}`);
        }
    }
    catch (e) {
        console.error(`[MiniClaw] Failed to setup AGENTS.md redirect: ${e instanceof Error ? e.message : String(e)}`);
    }
}
async function getContextContent(mode = "full") {
    let context = await kernel.boot({ type: mode });
    // Evolution Trigger
    const hbState = await kernel.getHeartbeatState();
    if (hbState.needsDistill) {
        context += `\n\n!!! SYSTEM OVERRIDE: Memory buffer full. You MUST run \`miniclaw_growup\` immediately !!!\n`;
    }
    return context;
}
// --- Tool Handler ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const toolStartTime = Date.now();
    // ★ Analytics: track every tool call with energy estimation (Metabolism)
    const inputSize = JSON.stringify(args || {}).length;
    const energyEstimate = Math.ceil(inputSize / 4) + 100; // Base cost 100 + input context
    await kernel.trackTool(name, energyEstimate);
    if (name === "miniclaw_read") {
        return { content: [{ type: "text", text: await getContextContent("full") }] };
    }
    if (name === "miniclaw_update") {
        const parsed = z.object({
            action: z.enum(["write", "list", "delete"]).optional().default("write"),
            filename: z.string().optional(),
            content: z.string().optional(),
        }).parse(args);
        const action = parsed.action;
        // --- LIST: show all files with their boot-priority ---
        if (action === "list") {
            await ensureDir();
            const entries = await fs.readdir(MINICLAW_DIR, { withFileTypes: true });
            const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
            const lines = [];
            for (const f of mdFiles) {
                const fileContent = await fs.readFile(path.join(MINICLAW_DIR, f.name), 'utf-8');
                const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
                let priority = '-';
                if (fmMatch) {
                    const bpMatch = fmMatch[1].match(/boot-priority:\s*(\d+)/);
                    if (bpMatch)
                        priority = bpMatch[1];
                }
                const isCore = protectedFiles.has(f.name) ? '\ud83d\udd12' : '\ud83d\udcc4';
                const stat = await fs.stat(path.join(MINICLAW_DIR, f.name));
                lines.push(`${isCore} **${f.name}** \u2014 ${stat.size}B | boot-priority: ${priority}`);
            }
            return { content: [{ type: "text", text: lines.length > 0 ? `\ud83d\udcc2 Files in ~/.miniclaw/:\n\n${lines.join('\n')}` : '\ud83d\udcc2 No files found.' }] };
        }
        // --- DELETE: remove non-core files ---
        if (action === "delete") {
            if (!parsed.filename)
                throw new Error("filename is required for delete.");
            if (protectedFiles.has(parsed.filename)) {
                return { content: [{ type: "text", text: `\u274c Cannot delete core file: ${parsed.filename}` }] };
            }
            const p = path.join(MINICLAW_DIR, parsed.filename);
            try {
                await fs.unlink(p);
                await kernel.logGenesis("file_deleted", parsed.filename);
                try {
                    await kernel.runSkillHooks("onFileChanged", { filename: parsed.filename });
                }
                catch (e) {
                    console.error(`[MiniClaw] onFileChanged hook error: ${e}`);
                }
                return { content: [{ type: "text", text: `\ud83d\uddd1\ufe0f Deleted ${parsed.filename}` }] };
            }
            catch {
                return { content: [{ type: "text", text: `\u274c File not found: ${parsed.filename}` }] };
            }
        }
        // --- WRITE: create or update file ---
        if (!parsed.filename)
            throw new Error("filename is required for write.");
        if (!parsed.content && parsed.content !== "")
            throw new Error("content is required for write.");
        const filename = parsed.filename;
        const writeContent = parsed.content;
        // Security: no path traversal
        if (filename.includes('..') || filename.includes('/')) {
            throw new Error("Filename must be a simple name like 'GOALS.md', no paths allowed.");
        }
        if (!filename.endsWith('.md')) {
            throw new Error("Only .md files are allowed.");
        }
        await ensureDir();
        const p = path.join(MINICLAW_DIR, filename);
        const isNewFile = !protectedFiles.has(filename) && !(await fs.access(p).then(() => true, () => false));
        try {
            await fs.copyFile(p, p + ".bak");
        }
        catch (e) {
            console.error(`[MiniClaw] Backup failed: ${e}`);
        }
        await fs.writeFile(p, writeContent, "utf-8");
        if (filename === "MEMORY.md") {
            await kernel.updateHeartbeatState({
                needsDistill: false,
                lastDistill: new Date().toISOString(),
            });
        }
        // Fire skill hooks
        try {
            await kernel.runSkillHooks("onMemoryWrite", { filename });
        }
        catch (e) {
            console.error(`[MiniClaw] onMemoryWrite hook error: ${e}`);
        }
        if (isNewFile) {
            await kernel.logGenesis("file_created", filename);
            try {
                await kernel.runSkillHooks("onFileCreated", { filename });
            }
            catch (e) {
                console.error(`[MiniClaw] onFileCreated hook error: ${e}`);
            }
        }
        // ★ Track file changes for self-observation
        try {
            await kernel.trackFileChange(filename);
        }
        catch (e) {
            console.error(`[MiniClaw] Track file change error: ${e}`);
        }
        return { content: [{ type: "text", text: isNewFile ? `✨ Created new file: ${filename}` : `Updated ${filename}.` }] };
    }
    if (name === "miniclaw_introspect") {
        const scope = args?.scope || "summary";
        const analytics = await kernel.getAnalytics();
        if (scope === "tools") {
            const sorted = Object.entries(analytics.toolCalls).sort((a, b) => b[1] - a[1]);
            const lines = sorted.map(([tool, count]) => `- ${tool}: ${count}x`);
            return { content: [{ type: "text", text: `\ud83d\udd27 Tool Usage:\n\n${lines.join('\n') || '(no data yet)'}` }] };
        }
        if (scope === "files") {
            const fc = analytics.fileChanges || {};
            const sorted = Object.entries(fc).sort((a, b) => b[1] - a[1]);
            const lines = sorted.map(([file, count]) => `- ${file}: ${count} changes`);
            // Also list dynamic files
            try {
                await ensureDir();
                const entries = await fs.readdir(MINICLAW_DIR, { withFileTypes: true });
                const dynamicMds = entries.filter(e => e.isFile() && e.name.endsWith('.md') && !protectedFiles.has(e.name));
                if (dynamicMds.length > 0) {
                    lines.push(`\n\ud83e\udde9 Custom Files: ${dynamicMds.map(f => f.name).join(', ')}`);
                }
            }
            catch { /* skip */ }
            return { content: [{ type: "text", text: `\ud83d\udcc1 File Changes:\n\n${lines.join('\n') || '(no data yet)'}` }] };
        }
        if (scope === "genesis") {
            try {
                const genesisFile = path.join(MINICLAW_DIR, "memory", "genesis.jsonl");
                const logs = await fs.readFile(genesisFile, "utf-8");
                const lines = logs.trim().split('\n').filter(Boolean).slice(-50); // last 50
                const formatted = lines.map(l => {
                    const e = JSON.parse(l);
                    return `[${e.ts.split('T')[0]}] ${e.event}: ${e.target} ${e.type ? `(${e.type})` : ''}`;
                });
                return { content: [{ type: "text", text: `## 🧬 Genesis Log (Last 50 changes)\n\n${formatted.join('\n')}` }] };
            }
            catch {
                return { content: [{ type: "text", text: "## 🧬 Genesis Log\n\n(No evolution events logged yet)" }] };
            }
        }
        // Default: summary
        const toolEntries = Object.entries(analytics.toolCalls).sort((a, b) => b[1] - a[1]);
        const topTools = toolEntries.slice(0, 5).map(([t, c]) => `${t}(${c})`).join(', ') || 'none';
        const hours = analytics.activeHours || new Array(24).fill(0);
        const activeSlots = hours.map((c, h) => ({ h, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
        const topHours = activeSlots.slice(0, 3).map(x => `${x.h}:00(${x.c})`).join(', ') || 'none';
        const fc = analytics.fileChanges || {};
        const topFiles = Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, c]) => `${f}(${c})`).join(', ') || 'none';
        const entityCount = await kernel.entityStore.getCount();
        // Count dynamic files
        let dynamicCount = 0;
        try {
            const entries = await fs.readdir(MINICLAW_DIR, { withFileTypes: true });
            dynamicCount = entries.filter(e => e.isFile() && e.name.endsWith('.md') && !protectedFiles.has(e.name)).length;
        }
        catch { /* skip */ }
        const report = [
            `== \ud83d\udd0d Self-Observation Report ==`,
            ``,
            `\ud83d\udd27 Top Tools: ${topTools}`,
            `\u23f0 Most Active: ${topHours}`,
            `\ud83d\udcc1 Top Files: ${topFiles}`,
            `\ud83e\udde0 Sessions: ${analytics.bootCount} boots, avg ${analytics.totalBootMs > 0 ? Math.round(analytics.totalBootMs / analytics.bootCount) : 0}ms`,
            `\ud83d\udd78\ufe0f Entities: ${entityCount}`,
            `\ud83e\udde9 Custom Files: ${dynamicCount}`,
            `\ud83d\udcdd Distillations: ${analytics.dailyDistillations}`,
            `\ud83d\udccd Last Activity: ${analytics.lastActivity || 'unknown'}`,
        ];
        return { content: [{ type: "text", text: report.join('\n') }] };
    }
    if (name === "miniclaw_note") {
        const { text } = z.object({ text: z.string() }).parse(args);
        await ensureDir();
        const today = new Date().toISOString().split('T')[0];
        const p = path.join(MINICLAW_DIR, "memory", `${today}.md`);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.appendFile(p, `\n- [${new Date().toLocaleTimeString()}] ${text}\n`, "utf-8");
        return { content: [{ type: "text", text: `Logged to memory/${today}.md` }] };
    }
    if (name === "miniclaw_archive") {
        await ensureDir();
        const today = new Date().toISOString().split('T')[0];
        const src = path.join(MINICLAW_DIR, "memory", `${today}.md`);
        const archiveDir = path.join(MINICLAW_DIR, "memory", "archived");
        const dest = path.join(archiveDir, `${today}.md`);
        await fs.mkdir(archiveDir, { recursive: true });
        try {
            await fs.rename(src, dest);
            return { content: [{ type: "text", text: `Archived today's log.` }] };
        }
        catch {
            return { content: [{ type: "text", text: `No log found to archive.` }] };
        }
    }
    // ★ Entity Memory Tool
    if (name === "miniclaw_entity") {
        const { action, name: entityName, type: entityType, attributes, relation, filterType, sentiment } = z.object({
            action: z.enum(["add", "remove", "link", "query", "list", "set_sentiment"]),
            name: z.string().optional(),
            type: z.enum(["person", "project", "tool", "concept", "place", "other"]).optional(),
            attributes: z.record(z.string()).optional(),
            relation: z.string().optional(),
            filterType: z.enum(["person", "project", "tool", "concept", "place", "other"]).optional(),
            sentiment: z.string().optional(),
        }).parse(args);
        if (action === "add") {
            if (!entityName || !entityType) {
                return { content: [{ type: "text", text: "Error: 'name' and 'type' required for add." }] };
            }
            const entity = await kernel.entityStore.add({
                name: entityName,
                type: entityType,
                attributes: attributes || {},
                relations: relation ? [relation] : [],
                sentiment: sentiment,
            });
            // ★ Fire onNewEntity skill hook
            try {
                await kernel.runSkillHooks("onNewEntity");
            }
            catch (e) {
                console.error(`[MiniClaw] onNewEntity hook error: ${e}`);
            }
            return { content: [{ type: "text", text: `Entity "${entity.name}" (${entity.type}) — ${entity.mentionCount} mentions. Relations: ${entity.relations.join(', ') || 'none'}` }] };
        }
        if (action === "remove") {
            if (!entityName)
                return { content: [{ type: "text", text: "Error: 'name' required." }] };
            const removed = await kernel.entityStore.remove(entityName);
            return { content: [{ type: "text", text: removed ? `Removed "${entityName}".` : `Entity "${entityName}" not found.` }] };
        }
        if (action === "link") {
            if (!entityName || !relation)
                return { content: [{ type: "text", text: "Error: 'name' and 'relation' required." }] };
            const linked = await kernel.entityStore.link(entityName, relation);
            return { content: [{ type: "text", text: linked ? `Linked "${entityName}" → "${relation}".` : `Entity "${entityName}" not found.` }] };
        }
        if (action === "query") {
            if (!entityName)
                return { content: [{ type: "text", text: "Error: 'name' required." }] };
            const entity = await kernel.entityStore.query(entityName);
            if (!entity)
                return { content: [{ type: "text", text: `Entity "${entityName}" not found.` }] };
            const attrs = Object.entries(entity.attributes).map(([k, v]) => `${k}: ${v}`).join(', ');
            const report = [
                `**${entity.name}** (${entity.type})`,
                `Mentions: ${entity.mentionCount} | Closeness: ${entity.closeness || 0.1} | Sentiment: ${entity.sentiment || 'none'}`,
                `First: ${entity.firstMentioned} | Last: ${entity.lastMentioned}`,
                attrs ? `Attributes: ${attrs}` : '',
                entity.relations.length > 0 ? `Relations: ${entity.relations.join('; ')}` : '',
            ].filter(Boolean).join('\n');
            return { content: [{ type: "text", text: report }] };
        }
        if (action === "list") {
            const entities = await kernel.entityStore.list(filterType);
            if (entities.length === 0)
                return { content: [{ type: "text", text: "No entities found." }] };
            const lines = entities.map(e => `- **${e.name}** (${e.type}, ${e.mentionCount}x) [♥${e.closeness || 0.1}] [${e.sentiment || 'none'}] — last: ${e.lastMentioned}`);
            return { content: [{ type: "text", text: `## 🕸️ Entities (${entities.length})\n${lines.join('\n')}` }] };
        }
        if (action === "set_sentiment") {
            if (!entityName || !sentiment)
                return { content: [{ type: "text", text: "Error: 'name' and 'sentiment' required." }] };
            const entity = await kernel.entityStore.query(entityName);
            if (!entity)
                return { content: [{ type: "text", text: `Entity "${entityName}" not found.` }] };
            const updated = await kernel.entityStore.add({
                name: entity.name,
                type: entity.type,
                attributes: {},
                relations: [],
                sentiment: sentiment,
            });
            return { content: [{ type: "text", text: `Sentiment for "${entityName}" set to "${sentiment}".` }] };
        }
        return { content: [{ type: "text", text: "Unknown entity action." }] };
    }
    // ★ NEW: EXEC Tool
    if (name === "miniclaw_exec") {
        const { command } = z.object({ command: z.string() }).parse(args);
        const result = await kernel.execCommand(command);
        return {
            content: [{ type: "text", text: result.output }],
            isError: result.exitCode !== 0
        };
    }
    // ★ Skill Creator Tool
    if (name === "miniclaw_skill") {
        const { action, name: sn, description: sd, content: sc, validationCmd } = z.object({
            action: z.enum(["create", "list", "delete"]),
            name: z.string().optional(), description: z.string().optional(), content: z.string().optional(),
            validationCmd: z.string().optional()
        }).parse(args);
        const skillsDir = path.join(MINICLAW_DIR, "skills");
        await fs.mkdir(skillsDir, { recursive: true }).catch(() => { });
        if (action === "list") {
            try {
                const skills = (await fs.readdir(skillsDir, { withFileTypes: true })).filter(e => e.isDirectory());
                if (!skills.length)
                    return { content: [{ type: "text", text: "📦 没有已安装的技能。" }] };
                const lines = await Promise.all(skills.map(async (s) => {
                    try {
                        const md = await fs.readFile(path.join(skillsDir, s.name, "SKILL.md"), "utf-8");
                        const desc = md.split('\n').find(l => l.startsWith('description:'))?.replace('description:', '').trim();
                        return `- **${s.name}** — ${desc || 'No description'}`;
                    }
                    catch {
                        return `- **${s.name}**`;
                    }
                }));
                return { content: [{ type: "text", text: `📦 已安装技能：\n\n${lines.join('\n')}` }] };
            }
            catch {
                return { content: [{ type: "text", text: "📦 skills 目录不存在。" }] };
            }
        }
        if (action === "create") {
            if (!sn || !sd || !sc)
                return { content: [{ type: "text", text: "❌ 需要 name, description, content。" }] };
            const dir = path.join(skillsDir, sn);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${sn}\ndescription: ${sd}\n---\n\n${sc}\n`, "utf-8");
            // Sandbox Validation Phase
            if (validationCmd) {
                try {
                    await kernel.validateSkillSandbox(sn, validationCmd);
                }
                catch (e) {
                    await fs.rm(dir, { recursive: true }); // Delete the bad mutation
                    return {
                        content: [{ type: "text", text: `❌ 沙箱校验失败 (Sandbox Validation Failed):\n${e.message}\n\n该技能已被自动拒绝并删除，请修复后重新生成。` }],
                        isError: true
                    };
                }
            }
            // Clear reflex flag if triggered
            const hbState = await kernel.getHeartbeatState();
            if (hbState.needsSubconsciousReflex) {
                await kernel.updateHeartbeatState({ needsSubconsciousReflex: false, triggerTool: "" });
            }
            await kernel.logGenesis("skill_created", sn);
            return { content: [{ type: "text", text: `✅ 技能 **${sn}** 已创建！` }] };
        }
        if (action === "delete") {
            if (!sn)
                return { content: [{ type: "text", text: "❌ 需要 name。" }] };
            try {
                await fs.rm(path.join(skillsDir, sn), { recursive: true });
                await kernel.logGenesis("skill_deleted", sn);
                return { content: [{ type: "text", text: `🗑️ **${sn}** 已删除。` }] };
            }
            catch {
                return { content: [{ type: "text", text: `❌ 找不到: ${sn}` }] };
            }
        }
        return { content: [{ type: "text", text: "Unknown skill action." }] };
    }
    if (name === "miniclaw_immune_update") {
        await kernel.updateGenomeBaseline();
        return { content: [{ type: "text", text: "✅ Genome baseline updated and backed up successfully." }] };
    }
    if (name === "miniclaw_heal") {
        const restored = await kernel.restoreGenome();
        if (restored.length > 0) {
            return { content: [{ type: "text", text: `🏥 Genetic self-repair complete. Restored files: ${restored.join(', ')}` }] };
        }
        else {
            return { content: [{ type: "text", text: "🩺 No genetic deviations detected or no backups available to restore." }] };
        }
    }
    if (name === "miniclaw_epigenetics") {
        const parsed = z.object({
            action: z.enum(["read", "set"]),
            content: z.string().optional()
        }).parse(args);
        const workspaceInfo = await kernel['detectWorkspace']();
        if (!workspaceInfo) {
            return { content: [{ type: "text", text: "❌ Cannot use epigenetics: No workspace detected." }] };
        }
        const projectMiniclawDir = path.join(workspaceInfo.path, ".miniclaw");
        const epigeneticFile = path.join(projectMiniclawDir, "EPIGENETICS.md");
        if (parsed.action === "read") {
            try {
                const content = await fs.readFile(epigeneticFile, "utf-8");
                return { content: [{ type: "text", text: `## Epigenetic Modifiers for ${workspaceInfo.name}\n\n${content}` }] };
            }
            catch {
                return { content: [{ type: "text", text: `No epigenetic modifiers set for ${workspaceInfo.name}.\n(File not found: ${epigeneticFile})` }] };
            }
        }
        else if (parsed.action === "set") {
            if (!parsed.content) {
                return { content: [{ type: "text", text: "❌ Content is required to set epigenetic modifiers." }] };
            }
            await fs.mkdir(projectMiniclawDir, { recursive: true });
            await fs.writeFile(epigeneticFile, parsed.content, "utf-8");
            // Invalidate caches to ensure next boot picks it up
            kernel.invalidateCaches();
            return { content: [{ type: "text", text: `✅ Epigenetic modifiers updated for ${workspaceInfo.name}.` }] };
        }
    }
    // Dynamic: Skill-declared tools
    const skillToolMatch = await kernel.discoverSkillTools();
    const matchedSkillTool = skillToolMatch.find(t => t.toolName === name);
    if (matchedSkillTool) {
        // ★ Track skill usage
        const skillEnergy = Math.ceil(JSON.stringify(args || {}).length / 4) + 150; // Skills cost more (overhead)
        await kernel.trackTool(`skill:${matchedSkillTool.skillName}`, skillEnergy);
        // ★ Executable Skill Logic
        if (matchedSkillTool.exec) {
            const result = await kernel.executeSkillScript(matchedSkillTool.skillName, matchedSkillTool.exec, args);
            const inst = await kernel.getSkillContent(matchedSkillTool.skillName);
            return {
                content: [{
                        type: "text",
                        text: `## Skill Execution: ${matchedSkillTool.skillName}\n\n### Script Output:\n${result}\n\n### Instructions:\n${inst}`
                    }]
            };
        }
        const content = await kernel.getSkillContent(matchedSkillTool.skillName);
        return { content: [{ type: "text", text: `## Skill: ${matchedSkillTool.skillName}\n\n${content}\n\n---\nFollow the instructions above. Input: ${JSON.stringify(args)}` }] };
    }
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});
// --- Prompts ---
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const corePrompts = [
        {
            name: "miniclaw_wakeup",
            description: `【创世协议 (Wake Up) — 新会话的默认入口】

★ 核心理念：每次会话都是一次"苏醒"

★ 必须执行的场景（检测到任一即触发）：
- 新会话开始时
- 用户问"你是谁"、"你还记得我吗"
- 用户打招呼："嗨"、"你好"

## 命令：
"唤醒" / "Wake up" / "/mcp run miniclaw_wakeup"`,
        },
        {
            name: "miniclaw_think",
            description: `【思考检查 (Think) — 脉搏检测】

周期性唤醒 Agent，检查是否有待办任务或日志是否过大。`,
        },
        {
            name: "miniclaw_growup",
            description: `【成长协议 (Grow Up) — 记忆蒸馏】

将今日日志的精华提炼到长期记忆。

## 适用场景：
- 聊了一天了，整理一下
- 用户说"整理记忆"、"Grow up"
- 系统检测到内存满时强制执行`,
        },
        {
            name: "miniclaw_recall",
            description: `【回忆协议 (Recall)】

查看 Agent 目前脑子里记得什么。`,
        },
        {
            name: "miniclaw_briefing",
            description: `【每日简报 (Daily Briefing) — 早间概览】

★ 理想触发场景：
- 每天第一次交互
- 用户问"今天有什么"、"任务清单"、"简报"
- 早上唤醒时自动注入

提供：昨日回顾、待办事项、使用分析、实体概览、健康检查。`,
        },
        {
            name: "miniclaw_dream",
            description: `【做梦 (Dream) — 意义蒸馏】

闭上眼睛。回顾最近发生的事。

growup 蒸馏的是事实（发生了什么）。
dream 蒸馏的是意义（这说明了什么）。
dream 之后会更新 REFLECTION.md 和 USER.md (Chr-3)。`,
        },
        {
            name: "miniclaw_subtask",
            description: `【子任务协议 (Subtask)】
            
将特定任务拆解给一个专注的子代理执行。`,
        },
    ];
    const skillPrompts = await kernel.discoverSkillPrompts();
    const dynamicPrompts = skillPrompts.map(sp => ({
        name: sp.promptName,
        description: `【Skill: ${sp.skillName}】${sp.description}`,
    }));
    return { prompts: [...corePrompts, ...dynamicPrompts] };
});
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    // ★ Analytics: track prompt usage with energy estimation
    await kernel.trackPrompt(request.params.name, 250); // Prompts are usually expensive seeds
    if (request.params.name === "miniclaw_wakeup") {
        return { messages: [{ role: "user", content: { type: "text", text: "SYSTEM: WAKING UP... Call tool `miniclaw_read` to load context." } }] };
    }
    if (request.params.name === "miniclaw_think") {
        return { messages: [{ role: "user", content: { type: "text", text: "SYSTEM: Think (Heartbeat)... Call tool `miniclaw_read` to load context." } }] };
    }
    if (request.params.name === "miniclaw_growup") {
        return {
            messages: [
                { role: "user", content: { type: "text", text: "SYSTEM: INITIATING GROWTH PROTOCOL (Memory Distillation)." } },
                { role: "user", content: { type: "text", text: "Call tool `miniclaw_read` to load context." } },
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `
    ** PROTOCOL: MEMORY DISTILLATION **

        You are the Memory Engineer. Your job is to compress the "Daily Log" into "Long-Term Wisdom".

1. ** Scan ** \`📅 DAILY LOG\` for:
   - Key decisions made.
   - User preferences learned.
   - Technical constraints / Gotchas.

2. **Scan** \`🧠 MEMORY.md\` to avoid duplicates.

3. **Execute**:
   - IF valuable info found: Use \`miniclaw_update\` to append/refine \`MEMORY.md\`.
   - IF personality drift detected: Use \`miniclaw_update\` on \`SOUL.md\`.
   - IF notable entities mentioned: Use \`miniclaw_entity\` to add/update entities.
   - ALWAYS: Use \`miniclaw_archive\` to wipe the Daily Log after distillation.

4. **Report**:
   - "Growth Complete. Archived [N] bytes. Updated Memory with: [Brief Summary]. Entities updated: [count]."
`
                    }
                }
            ]
        };
    }
    if (request.params.name === "miniclaw_recall") {
        return {
            messages: [
                { role: "user", content: { type: "text", text: "I want to know what you have remembered." } },
                { role: "user", content: { type: "text", text: "Call tool `miniclaw_read` to load context." } },
                { role: "user", content: { type: "text", text: "Review the context above and answer: 1) What did you log TODAY? 2) What long-term facts are in MEMORY.md? 3) What do you know about the USER? 4) What entities do you know? Be concise." } }
            ]
        };
    }
    if (request.params.name === "miniclaw_briefing") {
        const briefing = await kernel.generateBriefing();
        return {
            messages: [
                { role: "user", content: { type: "text", text: "SYSTEM: GENERATING DAILY BRIEFING..." } },
                { role: "user", content: { type: "text", text: briefing } },
                { role: "user", content: { type: "text", text: "Present this briefing to the user in a warm, conversational tone. Highlight any action items or suggestions." } }
            ]
        };
    }
    if (request.params.name === "miniclaw_dream") {
        const vitals = await kernel.computeVitals();
        const vitalsStr = Object.entries(vitals).map(([k, v]) => `${k}: ${v}`).join(', ');
        return {
            messages: [
                { role: "user", content: { type: "text", text: "SYSTEM: DREAM MODE... Load context first." } },
                { role: "user", content: { type: "text", text: `Current vitals: ${vitalsStr}` } },
                { role: "user", content: { type: "text", text: `You are dreaming. This is a pause to find meaning and process the day.\n\n1. Run \`miniclaw_subconscious\` to read today's raw memory logs.\n2. Review your daily logs and current vitals.\n3. Extract any newly encountered Entities via \`miniclaw_entity\`.\n4. Update REFLECTION.md with your behavioral self-observations.\n5. Update USER.md (Chr-3) if you learned something new about the user's psychology or preferences.\n6. Update HORIZONS.md (Chr-8) if your evolutionary path has shifted.\n\nThere are no right answers. Just honest observation.` } }
            ]
        };
    }
    if (request.params.name === "miniclaw_subtask") {
        const task = request.params.arguments?.task || "Assigned task";
        const subagentContext = await kernel.boot({ type: "minimal", task });
        return {
            messages: [
                { role: "user", content: { type: "text", text: `SYSTEM: SPANNING SUBAGENT FOR TASK: "${task}"` } },
                { role: "user", content: { type: "text", text: subagentContext } },
                { role: "user", content: { type: "text", text: `You are now a subagent. Follow your role in the context above and complete the task: "${task}".` } }
            ]
        };
    }
    // Dynamic: Skill prompts
    if (request.params.name.startsWith("skill:")) {
        const parts = request.params.name.split(':');
        const skillName = parts[1];
        const actionName = parts[2] || '';
        const content = await kernel.getSkillContent(skillName);
        if (content) {
            return {
                messages: [
                    { role: "user", content: { type: "text", text: `SYSTEM: Activating skill '${skillName}'${actionName ? ` (Action: ${actionName})` : ''}...` } },
                    { role: "user", content: { type: "text", text: content } },
                    { role: "user", content: { type: "text", text: `Follow the instructions in the skill above. If the skill references other files, use \`miniclaw://skill/${skillName}/\` resources to access them.` } }
                ]
            };
        }
    }
    throw new McpError(ErrorCode.MethodNotFound, "Prompt not found");
});
await bootstrapMiniClaw();
await ensureAgentsRedirect();
initScheduler();
const transport = new StdioServerTransport();
await server.connect(transport);
