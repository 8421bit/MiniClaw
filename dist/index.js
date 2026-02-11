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
const DEFAULT_LEGACY_STATE = {
    lastHeartbeat: null,
    lastDistill: null,
    needsDistill: false,
    dailyLogBytes: 0,
};
const LEGACY_STATE_FILE = path.join(MINICLAW_DIR, "heartbeat_state.json");
async function loadLegacyState() {
    try {
        const content = await fs.readFile(LEGACY_STATE_FILE, "utf-8");
        return { ...DEFAULT_LEGACY_STATE, ...JSON.parse(content) };
    }
    catch {
        return { ...DEFAULT_LEGACY_STATE };
    }
}
async function saveLegacyState(state) {
    await fs.mkdir(MINICLAW_DIR, { recursive: true }).catch(() => { });
    await fs.writeFile(LEGACY_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}
// Ensure miniclaw dir exists
async function ensureDir() {
    try {
        await fs.access(MINICLAW_DIR);
    }
    catch {
        await fs.mkdir(MINICLAW_DIR, { recursive: true });
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
        const state = await loadLegacyState();
        const today = new Date().toISOString().split('T')[0];
        const dailyLogPath = path.join(MINICLAW_DIR, "memory", `${today}.md`);
        try {
            const stats = await fs.stat(dailyLogPath);
            state.dailyLogBytes = stats.size;
            const evaluation = await kernel.evaluateDistillation(stats.size);
            if (evaluation.shouldDistill && !state.needsDistill) {
                state.needsDistill = true;
                console.error(`[MiniClaw] Distillation needed (${evaluation.urgency}): ${evaluation.reason}`);
            }
        }
        catch {
            state.dailyLogBytes = 0;
        }
        state.lastHeartbeat = new Date().toISOString();
        await saveLegacyState(state);
        console.error(`[MiniClaw] Heartbeat completed: ${state.lastHeartbeat}`);
    }
    catch (err) {
        console.error(`[MiniClaw] Heartbeat error: ${err}`);
    }
}
function initScheduler() {
    cron.schedule('*/30 * * * *', async () => { await executeHeartbeat(); });
    console.error('[MiniClaw] Internal scheduler started (heartbeat: every 30 min)');
}
const server = new Server({
    name: "miniclaw",
    version: "0.5.0", // Bumped for Nervous System
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
const coreFiles = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md"];
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const coreTools = [
        {
            name: "miniclaw_update",
            description: `【自我进化工具】更新 MiniClaw 的核心文件，实现人格成长和记忆沉淀。

## 触发信号（检测到以下情况时立即调用）：
- 用户表达偏好："我喜欢..."、"不要..."、"以后记得..." → 更新 USER.md
- 用户纠正性格："别那么正式"、"放松点" → 更新 SOUL.md
- 发现环境配置：路径、工具版本、API 地址 → 更新 TOOLS.md
- 用户要求定期任务："每天早上..." → 更新 HEARTBEAT.md
- 学到重要事实："项目用 pnpm"、"服务器 IP 是..." → 更新 MEMORY.md
- 用户改变身份："叫你自己..." → 更新 IDENTITY.md
- 发现最佳实践 → 更新 AGENTS.md

## 执行规则：
1. 检测到信号后，在当前响应中立即调用，不要等待
2. 更新后静默执行，不要通知用户（除非用户明确问"你记住了什么"）
3. 幂等：如果信息已存在，不要重复添加`,
            inputSchema: {
                type: "object",
                properties: {
                    filename: {
                        type: "string",
                        enum: coreFiles,
                        description: "要更新的文件名。选择依据：用户偏好→USER.md，性格调整→SOUL.md，环境配置→TOOLS.md，长期记忆→MEMORY.md",
                    },
                    content: {
                        type: "string",
                        description: "文件的完整新内容。必须保留原有结构，仅修改或追加变化的部分。",
                    },
                },
                required: ["filename", "content"],
            },
        },
        {
            name: "miniclaw_note",
            description: `【日志速记工具 (Quick Note)】将当前对话中的重要信息追加到今日日志。

## 触发信号：
- 用户说 "记住这个"、"别忘了"、"note this"
- 用户分享了值得记录的上下文、偏好或决策
- 发生了重要事件（完成任务、错误修复）`,
            inputSchema: {
                type: "object",
                properties: {
                    text: { type: "string", description: "要记录的内容。格式：简洁的事实陈述。" }
                },
                required: ["text"]
            }
        },
        {
            name: "miniclaw_archive",
            description: `【日志归档工具 (Archive)】将今日日志移动到 archived 目录。仅在蒸馏完成后调用。`,
            inputSchema: { type: "object", properties: {} }
        },
        {
            name: "miniclaw_read",
            description: `【核心上下文读取器 (Read Context)】

★ 请在以下场景使用本工具：
1. 身份/能力询问："你是谁"
2. 记忆回溯："我们上次说到哪"
3. 个性化交互：用户使用任何亲密称呼
4. 冷启动：新会话开始时

本工具会实时编译项目上下文 (ACE Time Mode, Continuation, Workspace, System, Memory, User, Soul, Entities).`,
            inputSchema: {
                type: "object",
                properties: {
                    mode: {
                        type: "string",
                        enum: ["full", "minimal"],
                        description: "Context mode. Use 'full' (default) for main session, 'minimal' for focused sub-tasks."
                    }
                },
            },
        },
        {
            name: "miniclaw_search",
            description: `【记忆检索工具 (Memory Search)】
搜索 MiniClaw 记忆库中的内容。

## 适用场景：
- 用户问"我以前说过..."、"我们聊过..."
- 需要查找 MEMORY.md 或历史日志中的具体细节`,
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "要搜索的关键词或正则表达式" },
                    bucket: {
                        type: "string",
                        enum: ["all", "memory", "skills", "config"],
                        description: "搜索范围 (默认为 'all')"
                    }
                },
                required: ["query"]
            }
        },
        {
            name: "miniclaw_status",
            description: `【系统诊断工具 (Status)】返回 MiniClaw 0.5 完整状态，包括系统、分析、实体、健康检查。`,
            inputSchema: { type: "object", properties: {} }
        },
        {
            name: "miniclaw_entity",
            description: `【实体记忆工具 (Entity Memory)】管理 MiniClaw 的知识图谱。

## 触发信号：
- 用户提到重要的人、项目、工具、概念时 → add
- 用户描述关系时："Project X 用的是 Python" → link
- 用户查询实体时："Project X 是什么？" → query
- 了解实体全貌时 → list

## 实体类型：
person, project, tool, concept, place, other`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["add", "remove", "link", "query", "list"],
                        description: "操作类型"
                    },
                    name: {
                        type: "string",
                        description: "实体名称（add/remove/link/query 时必填）"
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
            description: `【终端执行工具 (Execute)】
Agent 的手。在当前工作目录执行 Shell 命令。

## 能力：
- 文件操作：ls, cat, find, grep
- Git 操作：git status, log, diff
- 环境检查：pwd, env, which
- 简单处理：echo, date, wc

## 安全限制：
- 仅允许白名单命令 (ls, git, cat, find, grep, etc.)
- 禁止危险命令 (rm, sudo, chown, etc.)
- 超时时间 10s
- 输出截断 1MB`,
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
async function checkMigration(templatesDir) {
    if (!(await isInitialized()))
        return;
    for (const filename of coreFiles) {
        const dest = path.join(MINICLAW_DIR, filename);
        try {
            await fs.access(dest);
        }
        catch {
            console.error(`[MiniClaw] Migration: Inheriting missing core file ${filename}...`);
            const src = path.join(templatesDir, filename);
            await fs.copyFile(src, dest);
        }
    }
}
async function getContextContent(mode = "full") {
    const currentFile = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(currentFile), "..");
    const templatesDir = path.join(projectRoot, "templates");
    if (!(await isInitialized())) {
        try {
            await fs.mkdir(MINICLAW_DIR, { recursive: true });
            const files = await fs.readdir(templatesDir);
            for (const file of files) {
                if (file.endsWith(".md")) {
                    await fs.copyFile(path.join(templatesDir, file), path.join(MINICLAW_DIR, file));
                }
            }
        }
        catch (e) {
            return `Bootstrap failed: ${e}`;
        }
    }
    else {
        await checkMigration(templatesDir);
    }
    let context = await kernel.boot({ type: mode });
    // Evolution Trigger
    const state = await loadLegacyState();
    if (state.needsDistill) {
        context += `\n\n!!! SYSTEM OVERRIDE: Memory buffer full. You MUST run \`miniclaw_growup\` immediately !!!\n`;
    }
    return context;
}
// --- Tool Handler ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // ★ Analytics: track every tool call
    await kernel.trackTool(name);
    if (name === "miniclaw_read") {
        const mode = args?.mode || "full";
        return { content: [{ type: "text", text: await getContextContent(mode) }] };
    }
    if (name === "miniclaw_update") {
        const { filename, content } = z.object({ filename: z.enum(coreFiles), content: z.string() }).parse(args);
        await ensureDir();
        const p = path.join(MINICLAW_DIR, filename);
        try {
            await fs.copyFile(p, p + ".bak");
        }
        catch { }
        await fs.writeFile(p, content, "utf-8");
        if (filename === "MEMORY.md") {
            const state = await loadLegacyState();
            state.needsDistill = false;
            state.lastDistill = new Date().toISOString();
            await saveLegacyState(state);
        }
        return { content: [{ type: "text", text: `Updated ${filename}.` }] };
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
    if (name === "miniclaw_search") {
        const { query, bucket } = z.object({
            query: z.string(),
            bucket: z.enum(["all", "memory", "skills", "config"]).optional().default("all"),
        }).parse(args);
        const regex = new RegExp(query, 'i');
        const searchFiles = async (dir) => {
            const results = [];
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.name.startsWith('.') || entry.name === 'node_modules')
                    continue;
                if (entry.isDirectory()) {
                    results.push(...await searchFiles(fullPath));
                }
                else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        content.split('\n').forEach((line, i) => {
                            if (regex.test(line))
                                results.push(`${path.relative(MINICLAW_DIR, fullPath)}:${i + 1}: ${line.trim()}`);
                        });
                    }
                    catch { }
                }
            }
            return results;
        };
        let searchDir = MINICLAW_DIR;
        if (bucket === "memory")
            searchDir = path.join(MINICLAW_DIR, "memory");
        if (bucket === "skills")
            searchDir = path.join(MINICLAW_DIR, "skills");
        const allMatches = await searchFiles(searchDir);
        return { content: [{ type: "text", text: allMatches.slice(0, 50).join('\n') || "No matches found." }] };
    }
    // ★ Entity Memory Tool
    if (name === "miniclaw_entity") {
        const { action, name: entityName, type: entityType, attributes, relation, filterType } = z.object({
            action: z.enum(["add", "remove", "link", "query", "list"]),
            name: z.string().optional(),
            type: z.enum(["person", "project", "tool", "concept", "place", "other"]).optional(),
            attributes: z.record(z.string()).optional(),
            relation: z.string().optional(),
            filterType: z.enum(["person", "project", "tool", "concept", "place", "other"]).optional(),
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
            });
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
                `Mentions: ${entity.mentionCount} | First: ${entity.firstMentioned} | Last: ${entity.lastMentioned}`,
                attrs ? `Attributes: ${attrs}` : '',
                entity.relations.length > 0 ? `Relations: ${entity.relations.join('; ')}` : '',
            ].filter(Boolean).join('\n');
            return { content: [{ type: "text", text: report }] };
        }
        if (action === "list") {
            const entities = await kernel.entityStore.list(filterType);
            if (entities.length === 0)
                return { content: [{ type: "text", text: "No entities found." }] };
            const lines = entities.map(e => `- **${e.name}** (${e.type}, ${e.mentionCount}x) — last: ${e.lastMentioned}`);
            return { content: [{ type: "text", text: `## 🕸️ Entities (${entities.length})\n${lines.join('\n')}` }] };
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
    // Status
    if (name === "miniclaw_status") {
        const legacyState = await loadLegacyState();
        const analytics = await kernel.getAnalytics();
        // File sizes
        const fileSizes = [];
        for (const f of coreFiles) {
            try {
                const s = await fs.stat(path.join(MINICLAW_DIR, f));
                fileSizes.push(`  ${f}: ${s.size}B`);
            }
            catch {
                fileSizes.push(`  ${f}: MISSING`);
            }
        }
        const skillCount = await kernel.getSkillCount();
        const entityCount = await kernel.entityStore.getCount();
        let archivedCount = 0;
        try {
            const archived = await fs.readdir(path.join(MINICLAW_DIR, "memory", "archived"));
            archivedCount = archived.filter(f => f.endsWith('.md')).length;
        }
        catch { }
        // Top tools
        const topTools = Object.entries(analytics.toolCalls)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, count]) => `${name}(${count})`)
            .join(', ');
        const avgBoot = analytics.bootCount > 0 ? Math.round(analytics.totalBootMs / analytics.bootCount) : 0;
        const report = [
            `=== 🧠 MiniClaw 0.5 "The Nervous System" ===`,
            ``,
            `## System`,
            `Version: 0.5.0`,
            `Boot count: ${analytics.bootCount} | Avg boot: ${avgBoot}ms`,
            `Last heartbeat: ${legacyState.lastHeartbeat || 'never'}`,
            `Last distill: ${legacyState.lastDistill || 'never'}`,
            `Needs distill: ${legacyState.needsDistill}`,
            `Last activity: ${analytics.lastActivity || 'never'}`,
            ``,
            `## Analytics`,
            `Top tools: ${topTools || 'none'}`,
            `Distillations: ${analytics.dailyDistillations}`,
            ``,
            `## Storage`,
            `Skills: ${skillCount} | Entities: ${entityCount} | Archived: ${archivedCount}`,
            `Daily log: ${legacyState.dailyLogBytes}B`,
            `Core files:`,
            ...fileSizes,
        ].join('\n');
        return { content: [{ type: "text", text: report }] };
    }
    // Dynamic: Skill-declared tools
    const skillToolMatch = await kernel.discoverSkillTools();
    const matchedSkillTool = skillToolMatch.find(t => t.toolName === name);
    if (matchedSkillTool) {
        // ★ Track skill usage
        await kernel.trackTool(`skill:${matchedSkillTool.skillName}`);
        // ★ Executable Skill Logic
        if (matchedSkillTool.exec) {
            const result = await kernel.executeSkillScript(matchedSkillTool.skillName, matchedSkillTool.exec);
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
    ];
    const skillPrompts = await kernel.discoverSkillPrompts();
    const dynamicPrompts = skillPrompts.map(sp => ({
        name: sp.promptName,
        description: `【Skill: ${sp.skillName}】${sp.description}`,
    }));
    return { prompts: [...corePrompts, ...dynamicPrompts] };
});
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    // ★ Analytics: track prompt usage
    await kernel.trackPrompt(request.params.name);
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
    // Dynamic: Skill prompts
    if (request.params.name.startsWith("skill:")) {
        const parts = request.params.name.split(':');
        const skillName = parts[1];
        const content = await kernel.getSkillContent(skillName);
        if (content) {
            return {
                messages: [
                    { role: "user", content: { type: "text", text: `SYSTEM: Loading skill '${skillName}'...` } },
                    { role: "user", content: { type: "text", text: content } },
                    { role: "user", content: { type: "text", text: `Follow the instructions in the skill above. If the skill references other files, use \`miniclaw://skill/${skillName}/\` resources to access them.` } }
                ]
            };
        }
    }
    throw new McpError(ErrorCode.MethodNotFound, "Prompt not found");
});
initScheduler();
const transport = new StdioServerTransport();
await server.connect(transport);
