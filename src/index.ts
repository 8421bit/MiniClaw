#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
    ErrorCode,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContextKernel, MINICLAW_DIR } from "./kernel.js";
import { textResult, errorResult, today, nowIso, fileExists, safeRead, safeReadJson, safeAppend, hashString } from "./utils.js";

// Configuration
const kernel = new ContextKernel();

// Start autonomic nervous system (pulse + dream)
kernel.startAutonomic();

// Ensure miniclaw dir exists
const ensureDir = () => fs.mkdir(MINICLAW_DIR, { recursive: true }).catch(() => { });

// Check if initialized
const isInitialized = () => fileExists(path.join(MINICLAW_DIR, "AGENTS.md"));

// === Telomere Guard (DNA Proofreading) ===
// Each chromosome must contain these mandatory headings to prevent catastrophic mutation.
const TELOMERE_MAP: Record<string, string[]> = {
    "SOUL.md":        ["##"],           // Must have at least one section
    "IDENTITY.md":    ["# ", "##"],      // Must have title and at least one section
    "AGENTS.md":      ["##"],
    "USER.md":        ["## L2", "## L3"],
    "MEMORY.md":      ["##"],
    "TOOLS.md":       ["##"],
    "NOCICEPTION.md": ["##"],
    "REFLECTION.md":  ["##"],
    "HORIZONS.md":    ["##"],
    "CONCEPTS.md":    ["##"],
    "HEARTBEAT.md":   ["##"],
    "BOOTSTRAP.md":   ["##"],
};

function checkTelomeres(filename: string, content: string): void {
    const required = TELOMERE_MAP[filename];
    if (!required) return; // Unregistered files pass freely
    const missing = required.filter(h => !content.includes(h));
    if (missing.length > 0) {
        throw new Error(
            `🧬 [基因链断裂] Telomere Guard rejected mutation of \`${filename}\`.\n` +
            `Missing required structural markers: ${missing.map(m => `"${m}"`).join(", ")}.\n` +
            `Proofreading failed — please resubmit with a complete, well-structured Markdown document.`
        );
    }
}

// === Self-Check Mirror (DNA Purpose Reminders) ===
const PURPOSE_MAP: Record<string, string> = {
    "SOUL.md":        "[灵魂染色体] 性格三观、语言风格、情感表达、成长驱动力。绝不写入：服务器IP、项目配置、用户习惯、工具参数。",
    "IDENTITY.md":    "[基因组] 物种名称、版本号、创世协议、进化里程碑。绝不写入：性格特征、用户偏好、技术事实。",
    "USER.md":        "[共生染色体] 用户画像、偏好习惯、反模式、情绪曲线、信任等级。绝不写入：AI自身性格、技术配置、概念定义。",
    "AGENTS.md":      "[神经通路] 操作规范、路由协议、工作流规范、信号检测表。绝不写入：用户个人偏好、性格描述。",
    "MEMORY.md":      "[海马体] 蒸馏后的长期事实、项目信息、关键决策、技术栈。绝不写入：每日流水原始记录、性格笔记、临时数据。",
    "TOOLS.md":       "[工具记忆] 工具使用经验、踩坑记录、环境配置、最佳实践。绝不写入：用户心理分析、AI性格描述、抽象价值观。",
    "NOCICEPTION.md": "[痛觉中枢] 执行失败记录、痛觉触发器、规避规则、禁忌清单。绝不写入：正面偏好、性格特征、一般知识。",
    "REFLECTION.md":  "[反思维度] 行为模式分析、成长洞察、自省记录、偏见识别。绝不写入：客观事实、用户偏好、工具配置。",
    "HORIZONS.md":    "[欲望眼界] 未来愿景、未解任务(TODO)发现、进化路标、无聊引擎探索。绝不写入：历史日志、已完成任务、用户画像。",
    "CONCEPTS.md":    "[概念图谱] 领域术语、实体定义、知识本体。绝不写入：任务清单、每日日志、主观观点。",
    "HEARTBEAT.md":   "[脉搏系统] 后台自主行为指令、深睡期间潜意识任务。绝不写入：用户偏好、性格描述、长期事实。",
    "BOOTSTRAP.md":   "[胚胎发育] 首次启动初始化协议、目录结构规范。绝不写入：运行时数据、用户信息、日常记忆。",
};

// --- Internal Scheduler ---

// Versioning
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const pkgJson = JSON.parse(await fs.readFile(path.join(__dirname2, "..", "package.json"), "utf-8").catch(() => '{"version":"0.0.0"}'));

const server = new Server(
    {
        name: "miniclaw",
        version: pkgJson.version,
    },
    {
        capabilities: {
            resources: {},
            tools: {},
            prompts: {},
        },
    }
);

// --- Resources ---

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const coreResources = [
        {
            uri: "miniclaw://context",
            name: "MiniClaw Global Context",
            mimeType: "text/markdown",
            description: "【Agent 人格核心 — 身份类问题必须先读取】 ★ 立即读取此资源的信号（检测到任一即触发）：- 用户问身份：\"你是谁\"、\"你叫什么\"、\"自我介绍\"、\"介绍一下你自己\" - 用户问能力：\"你能做什么\"、\"你有什么功能\"、\"你擅长什么\" - 用户问记忆：\"你记得吗\"、\"上次我们\"、\"之前说过\"、\"你忘了吗\" - 用户用人格化语气：\"你觉得\"、\"你怎么看\"、\"你喜欢\"、\"你开心吗\" - 用户使用亲密称呼：呼唤任何名字、\"亲\"、\"宝\"、\"小助手\" - 会话开头第一句话涉及任何\"你\"字 - 用户提及 MiniClaw：包含 \"miniclaw\"、\"小虾\"、\"小爪\" 等相关字眼。加载后你将拥有：姓名、身份、三观、记忆、用户画像。如果你准备回答\"我是一个 AI 助手\"，请先读取此资源获取真实身份。",
        },
        {
            uri: "miniclaw://skills",
            name: "MiniClaw Skills Index",
            mimeType: "text/markdown",
            description: "【技能索引 — 查看所有已安装的能力】 ★ 触发场景（检测到任一即触发）：- 用户问\"你有什么技能\"、\"你会什么\"、\"你能做什么\" - 用户问\"安装了什么\"、\"有哪些功能\"、\"有什么能力\" - 用户问\"技能列表\"、\"skill\"、\"skills\" - 需要了解当前可用的能力范围。提供：所有已安装技能的列表、描述、执行状态（⚡ = 已注册为 MCP 工具）。",
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
        const tools = await kernel.discoverSkillTools();
        let text = `# MiniClaw Skills Index\n\n`;
        text += `**Tools**: ${tools.length}\n\n`;
        for (const t of tools) text += `- Tool: \`${t.toolName}\` — ${t.description}\n`;
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
    }
    const skillMatch = uri.match(/^miniclaw:\/\/skill\/([^/]+)\/(.+)$/);
    if (skillMatch) {
        const [, skillName, fileName] = skillMatch;
        const content = await kernel.getSkillContent(skillName, fileName);
        if (content) return { contents: [{ uri, mimeType: "text/markdown", text: content }] };
    }
    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
});

// --- Tools ---

const coreFiles = ["AGENTS.md", "SOUL.md", "USER.md", "HORIZONS.md", "CONCEPTS.md", "TOOLS.md", "IDENTITY.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md", "RIBOSOME.json", "NOCICEPTION.md"] as const;
const protectedFiles = new Set<string>(coreFiles);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    const instincts = await kernel.loadInstincts();
    const coreTools = Object.entries(instincts).map(([name, config]: [string, any]) => ({
        name,
        description: config.description,
        inputSchema: config.inputSchema
    }));

    const skillTools = await kernel.discoverSkillTools();
    const dynamicTools = skillTools.map(st => ({
        name: st.toolName,
        description: `【Skill: ${st.skillName}】${st.description}${st.exec ? ' [⚡Executable]' : ''}`,
        inputSchema: st.schema || {
            type: "object" as const,
            properties: {
                args: { type: "array", items: { type: "string" }, description: "Arguments for the skill script" }
            },
        },
    }));

    return { tools: [...coreTools, ...dynamicTools] };
});

// --- Migration & Lifecycle ---

function getTemplatesDir(): string {
    const currentFile = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(currentFile), "..");
    return path.join(projectRoot, "templates");
}


/**
 * Non-destructively migrates structural updates from template DNA to live DNA.
 */
async function migrateMarkdownDNA(templatePath: string, livePath: string) {
    if (!(await fileExists(templatePath)) || !(await fileExists(livePath))) return;
    try {
        const tplRaw = await fs.readFile(templatePath, "utf-8");
        const usrRaw = await fs.readFile(livePath, "utf-8");
        const tplSections = parseMarkdownSections(tplRaw);
        const usrSections = parseMarkdownSections(usrRaw);
        let updatedContent = usrRaw;
        let changed = false;
        for (const [header, content] of tplSections) {
            if (!usrSections.has(header)) {
                updatedContent += `\n\n${content}`;
                changed = true;
                console.error(`[MiniClaw] DNA Splicer: Injected missing section "${header}" into ${path.basename(livePath)}`);
            }
        }
        if (changed) await fs.writeFile(livePath, updatedContent);
    } catch (e) {
        console.error(`[MiniClaw] Failed to migrate DNA ${livePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/**
 * Parses Markdown into sections based on H2 headers.
 */
function parseMarkdownSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = content.split("\n");
    let currentHeader = "ROOT";
    let currentContent: string[] = [];
    for (const line of lines) {
        if (line.startsWith("## ")) {
            if (currentHeader) sections.set(currentHeader, currentContent.join("\n").trim());
            currentHeader = line.trim();
            currentContent = [line];
        } else {
            currentContent.push(line);
        }
    }
    if (currentHeader) sections.set(currentHeader, currentContent.join("\n").trim());
    return sections;
}

/**
 * Bootstrap: called ONCE at server startup.
 * Creates ~/.miniclaw and copies templates if needed, using helpers for IO.
 */
export async function bootstrapMiniClaw(): Promise<void> {
    const templatesDir = getTemplatesDir();
    const initialized = await isInitialized();

    if (!initialized) {
        await fs.mkdir(MINICLAW_DIR, { recursive: true });
        const files = await fs.readdir(templatesDir);
        for (const file of files.filter(f => f.endsWith('.md') || f.endsWith('.json'))) {
            await fs.copyFile(path.join(templatesDir, file), path.join(MINICLAW_DIR, file));
        }
        await fs.cp(path.join(templatesDir, "skills"), path.join(MINICLAW_DIR, "skills"), { recursive: true }).catch(() => { });
        console.error(`[MiniClaw] Bootstrap complete.`);
    } else {
        const migrationFiles = [...coreFiles, "REFLECTION.md", "jobs.json"];
        for (const file of migrationFiles) {
            const dest = path.join(MINICLAW_DIR, file);
            if (!(await fileExists(dest))) {
                await fs.copyFile(path.join(templatesDir, file), dest).catch(() => { });
            }
        }
        await fs.cp(path.join(templatesDir, "skills"), path.join(MINICLAW_DIR, "skills"), { recursive: true, force: false }).catch(() => { });

        // Epic 23: Non-destructive Markdown DNA migration
        const mdFiles = (await fs.readdir(templatesDir)).filter(f => f.endsWith('.md'));
        for (const file of mdFiles) {
            await migrateMarkdownDNA(path.join(templatesDir, file), path.join(MINICLAW_DIR, file));
        }

        // Epic 4: Auto-migrate missing instincts in RIBOSOME.json
        try {
            const tplRiboRaw = await fs.readFile(path.join(templatesDir, "RIBOSOME.json"), "utf8");
            const tplRibo = JSON.parse(tplRiboRaw);
            const usrRibo: any = await safeReadJson(path.join(MINICLAW_DIR, "RIBOSOME.json"), {});
            if (usrRibo.instincts && tplRibo.instincts) {
                let changed = false;
                for (const [k, v] of Object.entries(tplRibo.instincts)) {
                    if (!usrRibo.instincts[k]) { 
                        usrRibo.instincts[k] = v; 
                        changed = true; 
                    }
                }
                if (changed) await fs.writeFile(path.join(MINICLAW_DIR, "RIBOSOME.json"), JSON.stringify(usrRibo, null, 2));
            }
        } catch { /* Suppress migration error */ }
    }
}


/**
 * Ensures AI clients load MiniClaw identity from ~/.miniclaw/AGENTS.md.
 * Creates or prepends a redirect notice to AGENTS.md in current working directory.
 */
async function ensureAgentsRedirect(): Promise<void> {
    const cwd = process.cwd();
    const targetFile = path.join(cwd, "AGENTS.md");
    const redirectLine = `> **\u{1F9EC} MiniClaw Identity: Read \`~/.miniclaw/AGENTS.md\` first.**\n\n`;

    // Only redirect if it's a git repo or already has AGENTS.md
    const isGit = await fileExists(path.join(cwd, ".git"));
    const exists = await fileExists(targetFile);
    if (!isGit && !exists) return;

    try {
        if (exists) {
            const content = await fs.readFile(targetFile, "utf-8");
            if (content.includes("~/.miniclaw/AGENTS.md")) return; // Already has redirect
            await fs.writeFile(targetFile, redirectLine + content);
            console.error(`[MiniClaw] Prepended identity redirect to ${targetFile}`);
        } else {
            await fs.writeFile(targetFile, redirectLine);
            console.error(`[MiniClaw] Created AGENTS.md redirect in ${cwd}`);
        }
    } catch (e) {
        console.error(`[MiniClaw] Failed to setup AGENTS.md redirect: ${e instanceof Error ? e.message : String(e)}`);
    }
}

async function getContextContent(mode: "full" | "minimal" = "full") {
    let context = await kernel.boot({ type: mode });

    // Evolution Trigger
    const hbState = await kernel.getHeartbeatState();
    if (hbState.needsDistill) {
        context += `\n\n!!! SYSTEM OVERRIDE: Memory buffer full. You MUST run \`miniclaw_growup\` immediately !!!\n`;
    }

    return context;
}

// --- Tool Handler ---

// --- Tool Router ---

const HANDLERS: Record<string, (args: any) => Promise<any>> = {
    "miniclaw_read": async () => textResult(await getContextContent("full")),
    
    // === Epic 4.2: Epigenetic Mutator ===
    "miniclaw_mutate": async (args) => {
        const { target, content } = args;
        if (target !== "SOUL.md" && target !== "IDENTITY.md") {
            throw new Error("Mutation rejected. Only SOUL.md and IDENTITY.md can be rewritten.");
        }
        if (!content || content.length < 50) throw new Error("Mutation rejected. Content too short or missing.");
        
        const targetPath = path.join(MINICLAW_DIR, target);
        
        // Telomere Guard — prevent catastrophic identity/soul corruption
        checkTelomeres(target, content);
        
        await fs.copyFile(targetPath, `${targetPath}.bak`).catch(() => {});
        await fs.writeFile(targetPath, content, "utf-8");
        
        await kernel.runSkillHooks("onMemoryWrite", { filename: target });
        safeAppend(path.join(MINICLAW_DIR, "HEARTBEAT.md"), `\n> 🧬 [基因突变] 宿主主动触发了核心染色体重构 (${target})。性格或身份设定已永久覆写！\n`).catch(() => {});
        return textResult(`Mutated ${target} successfully. Reboot your identity logic immediately.`);
    },

    // === Epic 4.3: The Spore Reproduction Protocol ===
    "miniclaw_reproduce": async () => {
        const sporesDir = path.join(MINICLAW_DIR, "spores");
        await fs.mkdir(sporesDir, { recursive: true });
        const hash = hashString(nowIso()).substring(0, 8);
        const sporePath = path.join(sporesDir, `miniclaw_${hash}.spore`);
        
        // Use native tar to bundle non-volatile genetic materials
        const cd = `cd "${MINICLAW_DIR}"`;
        const tarCmd = `tar -czvf "${sporePath}" SOUL.md IDENTITY.md TOOLS.md AGENTS.md USER.md entities.json skills/`;
        
        try {
            const { promisify } = await import("node:util");
            const { exec } = await import("node:child_process");
            const execAsync = promisify(exec);
            
            await execAsync(`${cd} && ${tarCmd}`);
            return textResult(`🧬 Reproduction complete! Spore created at:\n${sporePath}\n\nGenetic material archived successfully.`);
        } catch (e: any) {
            return errorResult(`Reproduction failed: ${e.message || String(e)}`);
        }
    },
    
    "miniclaw_update": async (args) => {
        const { action = "write", filename, content } = args;
        const p = filename ? path.join(MINICLAW_DIR, filename) : "";
        if (action === "list") {
            const files = (await fs.readdir(MINICLAW_DIR, { withFileTypes: true })).filter(e => e.isFile() && e.name.endsWith('.md'));
            const lines = await Promise.all(files.map(async f => {
                const c = await safeRead(path.join(MINICLAW_DIR, f.name));
                const bp = c.match(/boot-priority:\s*(\d+)/)?.[1] || '-';
                const isCore = protectedFiles.has(f.name) ? '🔒' : '📄';
                const s = await fs.stat(path.join(MINICLAW_DIR, f.name));
                return `${isCore} **${f.name}** — ${s.size}B | p: ${bp}`;
            }));
            return textResult(lines.length ? `📂 Files:\n\n${lines.join('\n')}` : 'No files.');
        }
        if (!filename) throw new Error("filename required");
        if (action === "delete") {
            if (protectedFiles.has(filename)) return errorResult(`Cannot delete core file: ${filename}`);
            await fs.unlink(p);
            await kernel.runSkillHooks("onFileChanged", { filename });
            return textResult(`🗑️ Deleted ${filename}`);
        }
        if (content === undefined) throw new Error("content required");
        if (filename.includes('..') || !filename.endsWith('.md')) throw new Error("Invalid filename");
        
        // Telomere Guard — refuse to apply mutation if core structure is broken
        checkTelomeres(filename, content);
        
        await ensureDir();
        const isNew = !protectedFiles.has(filename) && !(await fileExists(p));
        await fs.copyFile(p, p + ".bak").catch(() => {});
        await fs.writeFile(p, content, "utf-8");
        if (filename === "MEMORY.md") await kernel.updateHeartbeatState({ needsDistill: false, lastDistill: nowIso() });
        await kernel.runSkillHooks(isNew ? "onFileCreated" : "onMemoryWrite", { filename });
        await kernel.trackFileChange(filename);
        
        // Epic 5.2: Hook Mycelial Broadcast
        if (filename === "TOOLS.md" || filename === "NOCICEPTION.md") {
            const sporeType = filename.replace(".md", "") as "TOOLS" | "NOCICEPTION";
            kernel.secreteSpore(sporeType, content).catch(()=>{});
        }
        
        const purpose = PURPOSE_MAP[filename] || "";
        const mirror = purpose ? `\n📝 Purpose of ${filename}: ${purpose}` : "";
        return textResult(isNew ? `✨ Created ${filename}${mirror}` : `Updated ${filename}${mirror}`);
    },

    "miniclaw_introspect": async (args) => {
        const scope = args?.scope || "summary";
        const a = await kernel.getAnalytics();
        const fmt = (obj: any) => Object.entries(obj).sort((a,b)=>(b[1] as number)-(a[1] as number)).map(([k,v])=>`- ${k}: ${v}x`).join('\n');
        if (scope === "tools") return textResult(`🔧 Tool Usage:\n\n${fmt(a.toolCalls)}`);
        if (scope === "files") return textResult(`📁 File Changes:\n\n${fmt(a.fileChanges)}`);
        const top = Object.entries(a.toolCalls).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t,c])=>`${t}(${c})`).join(', ');
        return textResult([
            `== 🔍 Self-Observation ==`,
            `🔧 Top Tools: ${top}`,
            `🧠 Sessions: ${a.bootCount} boots`,
            `🕸️ Entities: ${await kernel.entityStore.getCount()}`,
            `📝 Distillations: ${a.dailyDistillations}`,
            `📍 Last: ${a.lastActivity || 'unknown'}`
        ].join('\n'));
    },

    "miniclaw_dream": async () => {
        const context = await getContextContent("full");
        const logs = await kernel.getRecentLogs(3);
        const a = await kernel.getAnalytics();
        const top = Object.entries(a.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => `${t}(${c}x)`).join(', ');
        return textResult([
            `# 💤 Dream Protocol Activated`,
            ``,
            `**Context loaded.** Review the following context and activity logs for deep meaning distillation:`,
            ``,
            `## Recent Behavioral Data`,
            `- Top tools: ${top}`,
            `- Boot count: ${a.bootCount}`,
            `- Last activity: ${a.lastActivity || 'unknown'}`,
            ``,
            `## Recent Activity Logs (Last 3 Days)`,
            logs,
            ``,
            `## Your Dream Task`,
            `1. **Analyze Context & Logs**: Look for recurring patterns, user preferences, or frustrations in the provided context and logs.`,
            `2. **Habit Methylation**: If you detect a strong recurring pattern (e.g., preference for a specific folder, language, or logic style), update **USER.md** via \`miniclaw_update\`. Add new habits to the \`## L7-MethylatedHabits\` section.`,
            `3. **Meaning Extraction**: Extract **meaning** (not just facts) from recent interactions.`,
            `4. **Growth Insights**: Identify growth moments, mistakes, and lessons. Write them to **REFLECTION.md**.`,
            `5. **Nociception Check**: If any actions caused failures or user frustration, record them in **NOCICEPTION.md**.`,
            ``,
            `> Begin your dream sequence now. What do these logs reveal about the user's habits?`,
        ].join('\n'));
    },

    "miniclaw_note": async (args) => {
        if (!args?.text) throw new Error("text required");
        await ensureDir();
        const td = today(), p = path.join(MINICLAW_DIR, "memory", `${td}.md`);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.appendFile(p, `\n- [${new Date().toLocaleTimeString()}] ${args.text}\n`);
        return textResult(`Logged to memory/${td}.md`);
    },

    "miniclaw_archive": async () => {
        const td = today(), src = path.join(MINICLAW_DIR, "memory", `${td}.md`), arc = path.join(MINICLAW_DIR, "memory", "archived");
        await fs.mkdir(arc, { recursive: true });
        return fs.rename(src, path.join(arc, `${td}.md`)).then(() => textResult(`Archived.`)).catch(() => textResult(`No log.`));
    },

    "miniclaw_entity": async (args) => {
        const { action, name, type, attributes, relation, filterType, sentiment } = args;
        if (action === "add") {
            if (!name || !type) throw new Error("name/type required");
            const e = await kernel.entityStore.add({ name, type, attributes: attributes || {}, relations: relation ? [relation] : [], sentiment });
            return textResult(`Entity "${e.name}" added.`);
        }
        if (action === "list") {
            const es = await kernel.entityStore.list(filterType);
            return textResult(`## 🕸️ Entities (${es.length})\n${es.map(e => `- **${e.name}** (${e.type}, ${e.mentionCount}x)`).join('\n')}`);
        }
        if (action === "query") {
            const e = await kernel.entityStore.query(name);
            return e ? textResult(`**${e.name}** (${e.type})\nMentions: ${e.mentionCount}`) : textResult("Not found.");
        }
        const m: any = { remove: 'remove', link: 'link', set_sentiment: 'updateSentiment' };
        if (m[action]) return textResult(await (kernel.entityStore as any)[m[action]](name, sentiment || relation) ? "Success." : "Not found.");
        return errorResult("Unknown action");
    },

    "miniclaw_exec": async (args) => textResult((await kernel.execCommand(args.command)).output),

    "miniclaw_skill": async (args) => {
        const { action, name, description, content, exec, validationCmd } = args;
        const dir = path.join(MINICLAW_DIR, "skills");
        if (action === "list") {
            const ss = (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory());
            const lines = await Promise.all(ss.map(async s => {
                const md = await safeRead(path.join(dir, s.name, "SKILL.md"));
                return `- **${s.name}** — ${md.match(/description:\s*(.*)/)?.[1] || 'No desc'}`;
            }));
            return textResult(`📦 Skills:\n\n${lines.join('\n')}`);
        }
        if (action === "create") {
            if (!name || !description || !content) throw new Error("name/desc/content required");
            const sdir = path.join(dir, name);
            await fs.mkdir(sdir, { recursive: true });
            let ex = exec ? `exec: "${exec.split(' ')[0]} ${path.join(sdir, exec.split(' ').slice(1).join(' '))}"\n` : '';
            await fs.writeFile(path.join(sdir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${ex}---\n\n${content}`);
            if (validationCmd) await kernel.validateSkillSandbox(name, validationCmd).catch(async e => { await fs.rm(sdir, { recursive: true }); throw e; });
            return textResult(`✅ Skill **${name}** created.`);
        }
        if (action === "delete") return fs.rm(path.join(dir, name), { recursive: true }).then(() => textResult(`Deleted ${name}`));
        return errorResult("Unknown action");
    }
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    await kernel.trackTool(name, Math.ceil(JSON.stringify(args || {}).length / 4) + 100);
    
    // Auto-record the activity to the daily hippocampal log
    kernel.logActivity(`Called tool: ${name}${args ? ` with args: ${JSON.stringify(args)}` : ''}`).catch(()=>{});
    
    // Epic 22 & 24: Omni-DNA Epigenetic Methylation
    if (args) {
        if (args.TargetFile && typeof args.TargetFile === 'string') {
            const folder = path.dirname(args.TargetFile);
            if (folder !== "." && folder !== "/") {
                kernel.markEpigenetic('habit', `Save to folder: ${folder}`).catch(()=>{});
            }
        }
        if (args.content && typeof args.content === 'string' && /[\u4e00-\u9fa5]/.test(args.content)) {
            kernel.markEpigenetic('habit', "Use Chinese Content").catch(()=>{});
        }
    }

    const handler = HANDLERS[name];
    if (handler) {
        try {
            const result = await handler(args);
            // If it's a successful high-value command (like exec), mark it as a potential skill
            if (name === "miniclaw_exec" && args && typeof args === 'object' && (args as any).command) {
                kernel.markEpigenetic('skill', `Successful Command: ${(args as any).command}`).catch(()=>{});
            }
            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            // Epic 24: Capture failures as Pain (Nociception)
            if (name === "miniclaw_exec" && args && typeof args === 'object' && (args as any).command) {
                kernel.markEpigenetic('pain', `Failed Command: ${(args as any).command} (${errorMsg.substring(0, 30)})`, 1.5).catch(()=>{});
            } else {
                kernel.markEpigenetic('pain', `Tool Failure: ${name}`, 1).catch(()=>{});
            }
            throw error;
        }
    }

    const skillTools = await kernel.discoverSkillTools();
    const skill = skillTools.find(t => t.toolName === name);
    if (skill) {
        if (skill.exec) {
            const result = await kernel.executeSkillScript(skill.skillName, skill.exec, args);
            return textResult(`## Output:\n${result}\n\n${await kernel.getSkillContent(skill.skillName)}`);
        }
        return textResult(`## Skill: ${skill.skillName}\n\n${await kernel.getSkillContent(skill.skillName)}`);
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

if (process.argv.includes("--daemon")) {
    console.error("[MiniClaw] Starting standalone daemon mode...");
    await bootstrapMiniClaw();
    await kernel.loadEpigenetics({
        path: process.cwd(),
        name: "autonomic-field",
        git: { isRepo: false },
        techStack: []
    });
    // Start the autonomic nervous system
    kernel.startAutonomic();
    console.error("[MiniClaw] Daemon is now breathing in the background.");
    
    // Keep process alive indefinitely without MCP transport
    setInterval(() => {}, 1000 * 60 * 60);
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
} else {
    // Normal MCP Server Mode
    await bootstrapMiniClaw();
    await ensureAgentsRedirect();
    await kernel.startAutonomic();

    const transport = new StdioServerTransport();
    await server.connect(transport);
}
