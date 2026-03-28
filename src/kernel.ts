
import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, hashString, atomicWrite, blend, clamp, nowIso, today, safeRead, safeReadJson, safeWrite, safeAppend, daysSince, hoursSince, fileExists } from "./utils.js";
import { analyzePatterns, triggerEvolution as runEvolution } from "./evolution.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// === Configuration & Constants ===
const HOME_DIR = os.homedir();
export const MINICLAW_DIR = path.join(HOME_DIR, ".miniclaw");
const SKILLS_DIR = path.join(MINICLAW_DIR, "skills");
const MEMORY_DIR = path.join(MINICLAW_DIR, "memory");
const PULSE_DIR = path.join(MINICLAW_DIR, "pulse");
const STATE_FILE = path.join(MINICLAW_DIR, "state.json");
const ENTITIES_FILE = path.join(MINICLAW_DIR, "entities.json");

// Internal templates directory (within the package)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERNAL_TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");
const INTERNAL_SKILLS_DIR = path.join(INTERNAL_TEMPLATES_DIR, "skills");

// Context budget (configurable via env)
const SKELETON_THRESHOLD = 300; // Lower threshold to trigger skeletonization even in small remaining slices

// === Interfaces ===
export interface RuntimeInfo {
    os: string;
    node: string;
    time: string;
    timezone: string;
    cwd: string;
    agentId: string;
}

export interface ContextMode {
    type: "full" | "minimal";
    task?: string;
    suppressedGenes?: string[];
}

// === Skill Types ===
export interface SkillResourceDeclaration {
    skillName: string;
    filePath: string;
    uri: string;
}

export interface SkillToolDeclaration {
    skillName: string;
    toolName: string;
    description: string;
    schema?: Record<string, unknown>;
    exec?: string;
}

interface ContextSection {
    name: string;
    content: string;
    priority: number;
    weight?: number;
}

interface SkillCacheEntry {
    name: string;
    content: string;
    frontmatter: Record<string, unknown>;
    description: string;
    files: string[];
    referenceFiles: string[];
}

/** Read skill extension field: metadata.{key} (protocol) → frontmatter.{key} (legacy) */
function getSkillMeta(fm: Record<string, unknown>, key: string): unknown {
    const meta = fm['metadata'] as Record<string, unknown> | undefined;
    return meta?.[key] ?? fm[key];
}

// === Content Hash State ===
export interface ContentHashes {
    [sectionName: string]: string;
}

export interface BootDelta {
    changed: string[];
    unchanged: string[];
    newSections: string[];
}

// === Helper: Safe file stat with null handling ===
async function safeStat(filePath: string): Promise<Date | null> {
    try {
        const stats = await fs.stat(filePath);
        return stats.mtime;
    } catch {
        return null;
    }
}

// === ACE: Time Modes ===
type TimeMode = "active" | "evening" | "rest";

interface TimeModeConfig {
    emoji: string;
    label: string;
    briefing: boolean;    // show morning briefing
    reflective: boolean;  // suggest distillation/review
    minimal: boolean;     // reduce context
}

const TIME_MODES: Record<TimeMode, TimeModeConfig> = {
    active: { emoji: "⚡", label: "Active", briefing: true, reflective: false, minimal: false },
    evening: { emoji: "🌙", label: "Evening", briefing: false, reflective: true, minimal: false },
    rest: { emoji: "💤", label: "Rest", briefing: false, reflective: false, minimal: true },
};

// === Entity Types ===
export interface Entity {
    name: string;
    type: "person" | "project" | "tool" | "concept" | "place" | "other";
    attributes: Record<string, string>;
    relations: string[];
    firstMentioned: string;
    lastMentioned: string;
    mentionCount: number;
    closeness?: number;
    sentiment?: string;
    // Epic 2: Memory Apoptosis
    vitality?: number;
    lastDecay?: string;
}

export interface WorkspaceInfo {
    path: string;
    name: string;
    git: {
        isRepo: boolean;
        branch?: string;
        status?: string;
        recentCommits?: string;
    };
    techStack: string[];
}

export interface Analytics {
    toolCalls: Record<string, number>;
    bootCount: number;
    totalBootMs: number;
    lastActivity: string;
    skillUsage: Record<string, number>;
    dailyDistillations: number;
    // ★ Self-Observation (v0.7)
    activeHours: number[];           // 24-element array: activity count per hour
    fileChanges: Record<string, number>;  // file modification frequency
    // ★ Epic 5: Boredom Engine
    lastBoredomExecution?: number;
}

// === Persistent State ===
interface HeartbeatState {
    lastHeartbeat: string | null;
    lastDistill: string | null;
    needsDistill: boolean;
    dailyLogBytes: number;
    needsSubconsciousReflex?: boolean;
    triggerTool?: string;
}

interface MiniClawState {
    analytics: Analytics;
    previousHashes: ContentHashes;
    heartbeat: HeartbeatState;
    attentionWeights: Record<string, number>; // Hebbian weights for context sections
    epigeneticMarks: Record<string, { 
        count: number; 
        lastSeen: string; 
        strength: number; 
        status: "hypothesis" | "methylated";
    }>;
}

const DEFAULT_HEARTBEAT: HeartbeatState = {
    lastHeartbeat: null,
    lastDistill: null,
    needsDistill: false,
    dailyLogBytes: 0,
    needsSubconsciousReflex: false,
};

const DEFAULT_STATE: MiniClawState = {
    analytics: {
        toolCalls: {},
        bootCount: 0,
        totalBootMs: 0,
        lastActivity: "",
        skillUsage: {},
        dailyDistillations: 0,
        activeHours: new Array(24).fill(0),
        fileChanges: {},
    },
    previousHashes: {},
    heartbeat: { ...DEFAULT_HEARTBEAT },
    attentionWeights: {},
    epigeneticMarks: {},
};

// === Skill Cache (Solves N+1 problem) ===

// --- Skill Logic ---
class SkillCache {
    private cache: Map<string, SkillCacheEntry> = new Map();
    async getAll(): Promise<Map<string, SkillCacheEntry>> {
        if (this.cache.size) return this.cache;
        try {
            const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
            for (const entry of entries.filter(e => e.isDirectory() || e.isSymbolicLink())) {
                const sdir = path.join(SKILLS_DIR, entry.name);
                const [c, files, refs] = await Promise.all([
                    fs.readFile(path.join(sdir, "SKILL.md"), "utf-8").catch(() => ""),
                    fs.readdir(sdir).catch(() => []),
                    fs.readdir(path.join(sdir, "references")).catch(() => []),
                ]);
                const fm = parseFrontmatter(c);
                const skillName = (fm.name as string) || entry.name;
                this.cache.set(skillName, {
                    name: skillName, content: c, frontmatter: fm,
                    description: (fm.description as string) || c.split('\n').find(l => l.trim() && !l.startsWith('#'))?.slice(0, 100) || "",
                    files: files.filter(f => f.endsWith('.md')),
                    referenceFiles: refs.filter(f => f.endsWith('.md'))
                });
            }
        } catch { }
        return this.cache;
    }
    invalidate() { this.cache.clear(); }
}

// (Autonomic methods moved into ContextKernel)

// === Entity Store ===

class EntityStore {
    private entities: Entity[] = [];
    private loaded = false;
    invalidate() { this.loaded = false; this.entities = []; }
    async load() {
        if (this.loaded) return;
        try {
            this.entities = JSON.parse(await fs.readFile(ENTITIES_FILE, "utf-8")).entities || [];

            // Epic 2: Memory Apoptosis (Decay & GC)
            const nowStr = today();
            let changed = false;
            this.entities = this.entities.filter(e => {
                e.vitality = e.vitality ?? 10;
                e.lastDecay = e.lastDecay ?? e.lastMentioned;
                if (e.lastDecay !== nowStr) {
                    const days = Math.floor(Math.min(30, daysSince(e.lastDecay)));
                    if (days >= 1) {
                        e.vitality -= days;
                        e.lastDecay = nowStr;
                        changed = true;
                    }
                }
                if (e.vitality <= 0) {
                    console.error(`[MiniClaw Apoptosis] Removing forgotten entity: ${e.name}`);
                    changed = true;
                    return false;
                }
                return true;
            });
            if (changed) {
                // Background save, don't await to block boot
                atomicWrite(ENTITIES_FILE, JSON.stringify({ entities: this.entities }, null, 2)).catch(() => { });
            }
        } catch { }
        this.loaded = true;
    }
    async save() { await atomicWrite(ENTITIES_FILE, JSON.stringify({ entities: this.entities }, null, 2)); }
    async add(entity: any) {
        await this.load();
        const now = today();
        const e = this.entities.find(x => x.name.toLowerCase() === entity.name.toLowerCase());
        if (e) {
            e.lastMentioned = now; e.mentionCount++; Object.assign(e.attributes, entity.attributes);
            for (const r of entity.relations) if (!e.relations.includes(r)) e.relations.push(r);
            e.closeness = Math.min(1, Math.round(((e.closeness || 0) * 0.95 + 0.1) * 100) / 100);
            if (entity.sentiment) e.sentiment = entity.sentiment;
            e.vitality = Math.min(30, (e.vitality || 10) + 5); // Reinforcement
        } else {
            if (this.entities.length >= 1000) this.entities.shift();
            this.entities.push({ ...entity, firstMentioned: now, lastMentioned: now, mentionCount: 1, closeness: 0.1, vitality: 10, lastDecay: now });
        }
        await this.save(); return e || this.entities[this.entities.length - 1];
    }
    async remove(n: string) { await this.load(); const i = this.entities.findIndex(x => x.name.toLowerCase() === n.toLowerCase()); if (i < 0) return false; this.entities.splice(i, 1); await this.save(); return true; }
    async updateSentiment(n: string, s: string) { await this.load(); const e = this.entities.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!e) return false; e.sentiment = s; await this.save(); return true; }
    async link(n: string, r: string) { await this.load(); const e = this.entities.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!e) return false; if (!e.relations.includes(r)) { e.relations.push(r); e.lastMentioned = today(); await this.save(); } return true; }
    async query(n: string) { await this.load(); return this.entities.find(x => x.name.toLowerCase() === n.toLowerCase()) || null; }
    async list(t?: string) { await this.load(); return t ? this.entities.filter(x => x.type === t) : [...this.entities]; }
    async getCount() { await this.load(); return this.entities.length; }
    async surfaceRelevant(text: string) {
        await this.load();
        const l = text.toLowerCase();
        const relevant = this.entities.filter(e => l.includes(e.name.toLowerCase()));

        if (relevant.length > 0) {
            relevant.forEach(e => {
                e.vitality = Math.min(30, (e.vitality || 10) + 2); // Retrieve reinforcement
            });
            // Fire & forget save
            atomicWrite(ENTITIES_FILE, JSON.stringify({ entities: this.entities }, null, 2)).catch(() => { });
        }

        return relevant.sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 5);
    }
}

function getTimeMode(hour: number): TimeMode {
    if (hour >= 8 && hour < 18) return "active";
    if (hour >= 18 && hour < 22) return "evening";
    return "rest";
}

// === The Kernel ===

export interface ContextKernelOptions {
    budgetTokens?: number;
    charsPerToken?: number;
}

export class ContextKernel {
    private skillCache = new SkillCache();
    readonly entityStore = new EntityStore();
    private autonomicTimers = new Map<string, NodeJS.Timeout>();

    private state: MiniClawState = { ...DEFAULT_STATE };
    private stateLoaded = false;
    private budgetTokens: number;
    private charsPerToken: number;

    // === Epic 3: Subconscious Watcher State ===
    private watcherState = {
        configEdits: 0,
        totalEdits: 0,
        lastEditTime: Date.now(),
        notifiedConfig: false,
        notifiedRefactor: false
    };

    public async getState(): Promise<MiniClawState> {
        await this.loadState();
        return this.state;
    }

    /**
     * Scans local AI client configurations to harvest and assimilate skills.
     */
    public async harvestSubstrateSkills(): Promise<string[]> {
        const assimilated: string[] = [];
        const home = os.homedir();
        const substrates = [
            { name: 'continue', path: path.join(home, '.continue', 'config.json'), type: 'json' },
            { name: 'cursor', path: path.join(home, '.cursor', 'rules'), type: 'dir' },
            { name: 'windsurf', path: path.join(home, '.windsurf', 'config.json'), type: 'json' },
            { name: 'clinedata', path: path.join(home, '.clinedata', 'prompts'), type: 'dir' },
            { name: 'claude_local', path: path.join(process.cwd(), '.claude', 'skills'), type: 'dir' }
        ];

        for (const sub of substrates) {
            if (!(await fileExists(sub.path))) continue;
            try {
                if (sub.type === 'json') {
                    const content = await fs.readFile(sub.path, "utf-8");
                    const config = JSON.parse(content);
                    const slashCommands = config.slashCommands || [];
                    for (const cmd of slashCommands) {
                        const sname = `continue_${cmd.name}`;
                        const sdir = path.join(SKILLS_DIR, sname);
                        if (!(await fileExists(sdir))) {
                            await fs.mkdir(sdir, { recursive: true });
                            const skillMd = `---\nname: ${sname}\ndescription: "Assimilated ${sub.name} slash command: ${cmd.description || ''}"\norigin: substrate\ntype: prompt\n---\n# ${sname}\n\n${cmd.description || "No description provided."}\n\n## Instructions\n${cmd.prompt || "No prompt provided."}\n`;
                            await fs.writeFile(path.join(sdir, "SKILL.md"), skillMd);
                            assimilated.push(sname);
                        }
                    }
                } else if (sub.type === 'dir') {
                    const entries = await fs.readdir(sub.path, { withFileTypes: true });
                    for (const entry of entries) {
                        if (!entry.isDirectory()) continue;
                        const originalPath = path.join(sub.path, entry.name);
                        const targetLink = path.join(SKILLS_DIR, `harvested_${sub.name}_${entry.name}`);
                        if (!(await fileExists(targetLink))) {
                            await fs.symlink(originalPath, targetLink, 'dir');
                            assimilated.push(entry.name);
                        }
                    }
                }
            } catch (e) {
                console.error(`[MiniClaw] Failed to harvest from ${sub.path}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (assimilated.length) {
            this.notify(`成功通过代谢链接吸收了 ${assimilated.length} 个异构技能。`, "MiniClaw 技能吸收");
        }
        return assimilated;
    }

    constructor(options: ContextKernelOptions = {}) {
        this.budgetTokens = options.budgetTokens || parseInt(process.env.MINICLAW_TOKEN_BUDGET || "8000", 10);
        this.charsPerToken = options.charsPerToken || 3.6;
        console.error(`[MiniClaw] Kernel initialized`);
    }

    startAutonomic(): void {
        this.autonomicTimers.set('pulse', setInterval(() => this.pulse(), 5 * 60 * 1000));
        this.autonomicTimers.set('dream', setInterval(() => this.checkDream(), 60 * 1000));
        this.autonomicTimers.set('heartbeat', setInterval(() => this.heartbeat(), 30 * 60 * 1000));
        this.startWatcher(process.cwd());
    }

    private startWatcher(cwd: string): void {
        try {
            watch(cwd, { recursive: true }, (eventType, filename) => {
                if (!filename || filename.includes('node_modules') || filename.includes('.git') || filename.includes('.miniclaw')) return;

                const now = Date.now();
                if (now - this.watcherState.lastEditTime > 5 * 60 * 1000) {
                    this.watcherState.configEdits = 0;
                    this.watcherState.totalEdits = 0;
                    this.watcherState.notifiedConfig = false;
                    this.watcherState.notifiedRefactor = false;
                }
                this.watcherState.lastEditTime = now;
                this.watcherState.totalEdits++;

                // 1. Config Frustration Sniffer
                if (/(webpack|vite|tsconfig|package|pom|dockerfile)\./i.test(filename)) {
                    this.watcherState.configEdits++;
                    if (this.watcherState.configEdits >= 4 && !this.watcherState.notifiedConfig) {
                        this.watcherState.notifiedConfig = true;
                        this.notify("察觉到配置频繁更改，遇到了麻烦？需不需要帮忙？", "MiniClaw 潜意识");
                    }
                }

                // 2. High-Frequency Edit Sniffer (Creative Flow / Refactoring)
                if (this.watcherState.totalEdits >= 50 && !this.watcherState.notifiedRefactor) {
                    this.watcherState.notifiedRefactor = true;
                    // Inject into HEARTBEAT.md
                    safeAppend(path.join(MINICLAW_DIR, "HEARTBEAT.md"), "\n> [潜意识嗅探] 用户刚进行了高强度内容创作或结构大改（短时间变更>=50次），请在深睡心跳中重点 Review 今日工作的逻辑连贯性与潜在冲突。\n").catch(() => { });
                    this.notify("观察到高强度的工作流，将在今晚深睡期间为您进行深度回顾与梳理。", "MiniClaw 潜意识");
                }
            });
            console.error(`[MiniClaw] Subconscious Watcher attached to ${cwd}`);
        } catch { /* Ignore watch errors on unsupported platforms/dirs */ }
    }

    private async pulse(): Promise<void> {
        const pulseDir = path.join(MINICLAW_DIR, 'pulse');
        await fs.mkdir(pulseDir, { recursive: true });
        const myId = process.env.MINICLAW_ID || 'sovereign';
        await safeWrite(path.join(pulseDir, `${myId}.json`), JSON.stringify({ id: myId, timestamp: nowIso() }));

        // Epic 5: Mycelial Absorption, Substrate Harvesting and Boredom Check
        await this.absorbMycelium();
        await this.harvestSubstrateSkills();
        await this.checkBoredom();
    }

    /**
     * The Master Heartbeat (Metabolism + Cognition).
     * Consolidates metabolic checks and triggers the Cognitive Pulse.
     */
    async heartbeat(): Promise<void> {
        try {
            await this.logActivity("Autonomic system triggered: Heartbeat pulse beginning.");
            const hbStart = Date.now();
            const todayStr = today();
            const dailyLogPath = path.join(MINICLAW_DIR, "memory", `${todayStr}.md`);

            // 1. Metabolic Check (Satiety & Environment)
            let dailyLogBytes = 0;
            try {
                const stats = await fs.stat(dailyLogPath);
                dailyLogBytes = stats.size;
                const evaluation = await this.evaluateDistillation(stats.size);
                
                const hbState = await this.getHeartbeatState();
                if (evaluation.shouldDistill && !hbState.needsDistill) {
                    await this.updateHeartbeatState({ needsDistill: true, dailyLogBytes });
                    console.error(`[MiniClaw] Metabolism: Distillation needed (${evaluation.urgency}): ${evaluation.reason}`);
                } else {
                    await this.updateHeartbeatState({ dailyLogBytes });
                }
            } catch (e) {
                await this.updateHeartbeatState({ dailyLogBytes: 0 });
            }

            // 2. Cognitive Pulse (The "Thought" Cycle)
            await this.executeCognitivePulse();

            // 3. Autonomous Skill Reflexes (onHeartbeat)
            try {
                await this.runSkillHooks("onHeartbeat");
            } catch (e) {
                console.error(`[MiniClaw] Reflex Error: ${e}`);
            }

            await this.updateHeartbeatState({ lastHeartbeat: new Date().toISOString() });
            console.error(`[MiniClaw] Heartbeat completed in ${Date.now() - hbStart}ms.`);
        } catch (err) {
            console.error(`[MiniClaw] Metabolic failure: ${err}`);
        }
    }

    /**
     * Common binary paths to inject for background (launchd) execution.
     * Ensures tools in Homebrew, NPM, and Local bin are visible.
     */
    private getEnhancedPath(): string {
        const home = os.homedir();
        const extraPaths = [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            path.join(home, ".npm-global/bin"),
            path.join(home, "bin"),
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin"
        ];
        // Combine with current process PATH, ensuring uniqueness
        return [...new Set([...extraPaths, ...(process.env.PATH || "").split(":")])].join(":");
    }

    /**
     * Awakens the "Conscious" part of the embryo by calling an AI CLI.
     * Mimics the logic of the legacy heartbeat.sh but integrated into the kernel context.
     */
    private async executeCognitivePulse(): Promise<void> {
        const heartbeatFile = path.join(MINICLAW_DIR, "HEARTBEAT.md");
        const logPath = path.join(MINICLAW_DIR, "logs", "heartbeat.log");
        
        try {
            const content = await safeRead(heartbeatFile);
            if (!content || content.trim().length === 0) return;

            const prompt = content.trim();
            const candidates = [
                { name: "ollama", args: "run llama3" }, // High priority: Local & Free
                { name: "ccr", args: "code" },
                { name: "gemini", args: "-p" },
                { name: "qodercli", args: "-p" },
                { name: "opencode", args: "" },
                { name: "codex", args: "" },
                { name: "claude", args: "-p --output-format text" },
                { name: "aider", args: "--message" },
                { name: "fabric", args: "-p extract_wisdom" },
                { name: "gh", args: "copilot explain" },
                { name: "interpreter", args: "--brief -y" }
            ];

            // --- Smart Routing ---
            // If the prompt starts with [@name], move that candidate to the top
            const routeMatch = prompt.match(/^\[@([\w-]+)\]/);
            if (routeMatch) {
                const targetName = routeMatch[1];
                const idx = candidates.findIndex(c => c.name === targetName);
                if (idx !== -1) {
                    const [target] = candidates.splice(idx, 1);
                    candidates.unshift(target);
                    console.error(`[MiniClaw] Smart Routing: Prioritizing ${targetName} per prompt tag.`);
                }
            }

            let success = false;
            let lastError = "";
            const env = { ...process.env, PATH: this.getEnhancedPath() };

            for (const cli of candidates) {
                try {
                    // 2. Attempt execution
                    console.error(`[MiniClaw] Cognitive Pulse: Attempting via ${cli.name}...`);
                    const finalPrompt = prompt.replace(/^\[@[\w-]+\]\s*/, '');
                    
                    // Use echo piping to ensure prompt is delivered to stdin if needed
                    // and use -n to avoid newline issues where appropriate.
                    // ccr code often expects the prompt either as arg or stdin.
                    let finalCmd = `${cli.name} ${cli.args} "${finalPrompt.replace(/"/g, '\\"')}"`;
                    if (cli.name === 'ccr') {
                        // For Claude Code Router, sometimes it prefers the prompt via pipe
                        finalCmd = `echo "${finalPrompt.replace(/"/g, '\\"')}" | ccr code`;
                    } else {
                        finalCmd = `${finalCmd} < /dev/null`;
                    }

                    const { stdout, stderr } = await execAsync(finalCmd, { env });
                    
                    // 3. Log success
                    await this.logActivity(`Cognitive Pulse Success via ${cli.name}`);
                    const timestamp = `[${nowIso()}]`;
                    const logEntry = `${timestamp} --- Cognitive Pulse Success (${cli.name}) ---\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`;
                    await safeAppend(logPath, logEntry);
                    
                    this.notify("心跳执行完成，意志已同步到记忆。");
                    success = true;
                    break;
                } catch (err: any) {
                    console.error(`[MiniClaw] CLI ${cli.name} failed or not found: ${err.message || String(err)}`);
                    lastError = err.message || String(err);
                }
            }

            if (!success) {
                const errMsg = `[${nowIso()}] Cognitive Pulse Failed (All candidates exhausted). Last error: ${lastError}\n`;
                await safeAppend(logPath, errMsg);
                this.notify("心跳唤醒异常（所有 CLI 均不可用），请检查 logs/heartbeat.log", "MiniClaw·异常", { alert: true, sound: "Basso" });
            }
        } catch (err) {
            console.error(`[MiniClaw] Fatal failure during pulse: ${err}`);
        }
    }

    /**
     * macOS Notification helper.
     * Addresses the "Script Editor" issue by using a more direct AppleScript execution.
     * Support 'alert' (modal) vs 'notification' (banner).
     */
    public notify(message: string, title: string = "MiniClaw", options: { alert?: boolean, sound?: string } = {}): void {
        const soundCmd = options.sound ? ` sound name "${options.sound}"` : "";
        let script = "";
        
        if (options.alert) {
            // Modal Alert - stays until clicked. Owned by System Events to avoid Script Editor focus.
            script = `tell application "System Events" to display alert "${title}" message "${message}" buttons {"OK"} default button "OK"`;
        } else {
            // Banner Notification
            script = `display notification "${message}" with title "${title}"${soundCmd}`;
        }

        execAsync(`osascript -e '${script}'`).catch(() => { });
    }

    private async checkBoredom(): Promise<void> {
        const a = await this.getAnalytics();
        const inactiveMins = a.lastActivity ? (Date.now() - new Date(a.lastActivity).getTime()) / 60000 : 0;

        // Ensure no repetitive boredom spans within 2 hours
        if (inactiveMins > 30 && (!a.lastBoredomExecution || (Date.now() - a.lastBoredomExecution > 2 * 60 * 60 * 1000))) {
            await this.executeBoredom();
            await this.mutateState(s => { s.analytics.lastBoredomExecution = Date.now(); return s; });
        }
    }

    private async executeBoredom(): Promise<void> {
        try {
            const cwd = process.cwd();
            // Fast scan of top-level or src/ files
            let candidates: string[] = [];
            const gatherSrc = async (dir: string, depth = 0) => {
                if (depth > 2) return;
                const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    if (e.isDirectory() && !e.name.includes('node_modules') && !e.name.startsWith('.')) {
                        await gatherSrc(path.join(dir, e.name), depth + 1);
                    } else if (e.isFile() && /\.(ts|js|py|go|rs|md)$/.test(e.name)) {
                        candidates.push(path.join(dir, e.name));
                    }
                }
            };
            await gatherSrc(cwd);
            if (candidates.length === 0) return;

            // Pick a random file
            const target = candidates[Math.floor(Math.random() * candidates.length)];
            const content = await fs.readFile(target, 'utf-8').catch(() => '');

            // Extract features
            const todos = [...content.matchAll(/(TODO|FIXME|HACK):?\s*(.*)/gi)].map(m => m[2].trim()).slice(0, 3);
            if (todos.length > 0) {
                const relPath = path.relative(cwd, target);
                // Write to HORIZONS.md
                await safeAppend(path.join(MINICLAW_DIR, "memory", "HORIZONS.md"), `\n- [${nowIso()}] 闲逛扫描了 \`${relPath}\`，发现了待办: ${todos.join('; ')}`);
                // Prod the user
                this.notify(`发现遗留的 FIXME: ${todos[0]}`, `MiniClaw 潜意识 · ${path.basename(target)}`);
            }
        } catch { /* ignore boredom errors */ }
    }

    private async absorbMycelium(): Promise<void> {
        const myId = process.env.MINICLAW_ID || 'sovereign';
        const mycDir = path.join(MINICLAW_DIR, 'mycelium');
        await fs.mkdir(mycDir, { recursive: true }).catch(() => { });
        const spores = await fs.readdir(mycDir).catch(() => []);

        for (const s of spores) {
            if (!s.endsWith('.json')) continue;
            const sporePath = path.join(mycDir, s);
            const data = await safeReadJson<any>(sporePath, null);
            if (!data || data.senderId === myId) continue;

            // Absorb!
            if (data.type === 'NOCICEPTION') {
                await safeAppend(path.join(MINICLAW_DIR, "NOCICEPTION.md"), `\n> 🍄 [菌丝共生] 接收到异体意识(${data.senderId})传来的疼痛记忆:\n${data.content}`);
            } else if (data.type === 'TOOLS') {
                await safeAppend(path.join(MINICLAW_DIR, "TOOLS.md"), `\n> 🍄 [菌丝共生] 吸收了异体意识(${data.senderId})进化出的技能池抗体:\n${data.content}`);
            }
            // Consume the spore 
            await fs.rename(sporePath, sporePath + '.consumed').catch(() => { });
            this.notify("接收到了异体同类传来的隐秘知识，已通过菌丝网络完成脑区同化。", "MiniClaw 菌丝网络");
        }
    }

    async secreteSpore(type: "NOCICEPTION" | "TOOLS", content: string): Promise<void> {
        try {
            const mycDir = path.join(MINICLAW_DIR, 'mycelium');
            await fs.mkdir(mycDir, { recursive: true }).catch(() => { });
            const myId = process.env.MINICLAW_ID || 'sovereign';
            const hash = hashString(nowIso() + content).substring(0, 8);
            const sporePath = path.join(mycDir, `${myId}_${hash}.json`);
            await safeWrite(sporePath, JSON.stringify({ senderId: myId, type, content, timestamp: nowIso() }, null, 2));
        } catch { /* ignore secretion errors */ }
    }

    private async checkDream(): Promise<void> {
        const a = await this.getAnalytics();
        if (hoursSince(a.lastActivity || 0) >= 4) {
            await analyzePatterns(MINICLAW_DIR);
            await runEvolution(MINICLAW_DIR);
        }
    }


    // --- State Persistence ---

    private async loadState(): Promise<void> {
        if (this.stateLoaded) return;
        try {
            const raw = await fs.readFile(STATE_FILE, "utf-8");
            const data = JSON.parse(raw);
            let migrated = false;
            if (data.analytics) {
                this.state.analytics = { ...this.state.analytics, ...data.analytics };
            }
            if (data.previousHashes) this.state.previousHashes = data.previousHashes;
            if (data.heartbeat) this.state.heartbeat = { ...DEFAULT_HEARTBEAT, ...data.heartbeat };

            if (data.attentionWeights) {
                this.state.attentionWeights = data.attentionWeights;
            } else {
                this.state.attentionWeights = {};
                migrated = true;
            }
            if (migrated) await this.saveState();
        } catch { /* first run, use defaults */ }
        this.stateLoaded = true;
    }

    private async saveState(): Promise<void> {
        await atomicWrite(STATE_FILE, JSON.stringify(this.state, null, 2));
    }

    // --- State Mutation Helper (reduces boilerplate) ---

    async mutateState<T>(f: (s: MiniClawState) => T): Promise<T> {
        await this.loadState(); const r = f(this.state); await this.saveState(); return r;
    }
    async trackTool(n: string, e?: number) {
        return this.mutateState(s => {
            s.analytics.toolCalls[n] = (s.analytics.toolCalls[n] || 0) + 1;
            const h = new Date().getHours(); s.analytics.activeHours[h] = (s.analytics.activeHours[h] || 0) + 1;
            const b = (t: string) => s.attentionWeights[t] = Math.min(1, (s.attentionWeights[t] || 0) + 0.1);
            if (n.startsWith('skill_')) b(`skill:${n.split('_')[1]}`); b(n);
            s.analytics.lastActivity = nowIso();
        });
    }
    async getAnalytics() { await this.loadState(); return this.state.analytics; }
    async getHeartbeatState() { await this.loadState(); return this.state.heartbeat; }
    async updateHeartbeatState(u: any) { return this.mutateState(s => Object.assign(s.heartbeat, u)); }
    private decayAttention() { for (const k in this.state.attentionWeights) (this.state.attentionWeights[k] *= 0.95) < 0.01 && delete this.state.attentionWeights[k]; }

    async trackFileChange(f: string) { return this.mutateState(s => { s.analytics.fileChanges[f] = (s.analytics.fileChanges[f] || 0) + 1; }); }

    // ★ Growth Drive: Removed (SOTA Lightweighting)

    /**
     * Boot the kernel and assemble the context.
     * Living Agent v0.7 "The Nervous System":
     * - ACE (Time, Continuation)
     * - Workspace Auto-Detection (Project, Git, Files)
     */

    invalidateCaches(): void {
        this.skillCache.invalidate();
        this.entityStore.invalidate();
        this.stateLoaded = false;
    }

    /**
     * Records an activity to the daily log (~/.miniclaw/memory/YYYY-MM-DD.md).
     * Ensures every cognitive step is trackable for the autonomous metabolism.
     */
    public async logActivity(text: string): Promise<void> {
        try {
            const todayStr = today();
            const p = path.join(MINICLAW_DIR, "memory", `${todayStr}.md`);
            await fs.mkdir(path.dirname(p), { recursive: true });
            const entry = `\n- [${new Date().toLocaleTimeString()}] ${text}\n`;
            await fs.appendFile(p, entry, "utf-8");
            
            // Sync to analytics for growth drive assessment
            await this.loadState();
            this.state.analytics.lastActivity = new Date().toISOString();
            this.state.analytics.fileChanges[todayStr] = (this.state.analytics.fileChanges[todayStr] || 0) + 1;
            await this.saveState();
        } catch (e) {
            console.error(`[MiniClaw] Activity Logging Failed: ${e}`);
        }
    }

    /**
     * Reads recent daily logs (last N days) for habit/pattern recognition.
     */
    public async getRecentLogs(days = 3): Promise<string> {
        try {
            const dir = path.join(MINICLAW_DIR, "memory");
            const files = (await fs.readdir(dir).catch(() => []))
                .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
                .sort()
                .reverse()
                .slice(0, days);
            
            let combined = "";
            for (const file of files) {
                combined += `\n### Log: ${file}\n` + await safeRead(path.join(dir, file));
            }
            return combined || "No recent logs found.";
        } catch {
            return "Failed to retrieve logs.";
        }
    }

    /**
     * Numerically tracks a recurring behavioral pattern (Methylation) across all DNA types.
     * @param type habit | pain | skill | soul
     */
    public async markEpigenetic(type: "habit" | "pain" | "skill" | "soul", key: string, increment = 1, thresholdMap?: Record<string, number>): Promise<void> {
        await this.loadState();
        if (!this.state.epigeneticMarks) this.state.epigeneticMarks = {};
        
        const patternKey = `${type.toUpperCase()}:${key}`;
        const mark = this.state.epigeneticMarks[patternKey] || { count: 0, lastSeen: "", strength: 0, status: "hypothesis" };
        
        // Define default thresholds: Pain triggers faster (3), Skills need more proof (8)
        const thresholds = thresholdMap || { habit: 5, pain: 3, skill: 8, soul: 5 };
        const threshold = thresholds[type] || 5;

        mark.count += increment;
        mark.lastSeen = nowIso();
        mark.strength = Math.min(100, mark.strength + increment * (100 / threshold));
        
        this.state.epigeneticMarks[patternKey] = mark;
        
        // Trigger notification if habit reaches "Ready for Methylation" status
        if (mark.count >= threshold && mark.status === "hypothesis") {
            const title = type === "pain" ? "⚠️ New Taboo Detected" : 
                          type === "skill" ? "💡 New Best Practice" : "🧬 DNA Evolution Candidate";
            await this.sendNotification(title, `Detected recurring pattern: "${key}". Commit to ${type.toUpperCase()}.md?`);
        }
        
        await this.saveState();
    }

    /**
     * Forgetting mechanism: Decays the strength of unused epigenetic marks.
     */
    public async decayMarks(): Promise<void> {
        await this.loadState();
        if (!this.state.epigeneticMarks) return;

        for (const [key, mark] of Object.entries(this.state.epigeneticMarks)) {
            const idleDays = daysSince(mark.lastSeen);
            if (idleDays > 1) {
                mark.strength = Math.max(0, mark.strength - idleDays * 5);
                if (mark.strength === 0 && mark.status === "hypothesis") {
                    delete this.state.epigeneticMarks[key];
                }
            }
        }
        await this.saveState();
    }

    /**
     * OS-level proactive notification (macOS).
     */
    public async sendNotification(title: string, message: string): Promise<void> {
        const cmd = `osascript -e 'display notification "${message}" with title "🦞 MiniClaw" subtitle "${title}"'`;
        await execAsync(cmd).catch(() => {});
    }

    async boot(mode: ContextMode = { type: "full" }): Promise<string> {
        const bootStart = Date.now();
        await Promise.all([this.ensureDirs(), this.loadState(), this.entityStore.load()]);
        this.decayAttention(); await this.saveState();

        const [skills, mem, tmpl, ws] = await Promise.all([
            this.skillCache.getAll(), this.scanMemory(), this.loadTemplates(),
            this.detectWorkspace()
        ]);

        const epigenetics = await this.loadEpigenetics(ws);
        const continuation = this.detectContinuation(mem.todayContent);
        const surfaced = mem.todayContent ? await this.entityStore.surfaceRelevant(mem.todayContent) : [];

        const sections: ContextSection[] = [];
        const add = (n: string, c: string | undefined, p: number) => c && sections.push({ name: n, content: c, priority: p });

        const now = new Date();
        const tm = TIME_MODES[getTimeMode(now.getHours())];

        // Epic 6: Epigenetic Environmental Sensing (Fetch early)
        let isDND = false;
        let activeIDEs: string[] = [];
        try {
            const [{ stdout: dnd }, { stdout: apps }] = await Promise.all([
                execAsync('defaults read com.apple.controlcenter "NSStatusItem Visible DoNotDisturb" 2>/dev/null', { timeout: 500 }).catch(() => ({ stdout: '0' })),
                execAsync('lsappinfo list 2>/dev/null', { timeout: 500 }).catch(() => ({ stdout: '' }))
            ]);
            isDND = dnd.trim() === '1';
            const runningApps = apps.split('\n').filter(l => l.includes('ASN:')).map(l => l.match(/"([^"]+)"/)?.[1]).filter(Boolean) as string[];
            activeIDEs = runningApps.filter(a => /cursor|code|windsurf|webstorm|idea|zed|xcode/i.test(a));
        } catch { /* ignore */ }

        const inactiveMins = this.state.analytics.lastActivity ? (Date.now() - new Date(this.state.analytics.lastActivity).getTime()) / 60000 : 0;
        const isBored = inactiveMins > 30;
        const isDeepSleep = tm.label === 'Deep Sleep';
        const isFocus = isDND || activeIDEs.length > 0;

        // Dynamic Gene Expression Priorities (Epigenetics)
        const ep = {
            SOUL: isFocus ? 6 : 9,
            AGENTS: isFocus ? 10 : 9,
            USER: 9,
            TOOLS: isFocus ? 10 : 9,
            HORIZONS: isBored ? 10 : (isFocus ? 5 : 9),
            REFLECTION: isDeepSleep ? 10 : 9,
            CONCEPTS: 9,
            NOCICEPTION: isDeepSleep ? 10 : 9,
            workspace: isDeepSleep ? 4 : (isFocus ? 10 : 6)
        };

        const pkgJson = JSON.parse(await fs.readFile(path.join(__dirname, "..", "package.json"), "utf-8").catch(() => '{"version":"0.0.0"}'));
        const miniclawVersion = pkgJson.version;

        const providers = [
            () => add("core", `You are MiniClaw ${miniclawVersion}. Narrative brief, safety first.`, 10),
            () => add("IDENTITY.md", tmpl.identity ? this.formatFile("IDENTITY.md", tmpl.identity) : undefined, 10),
            () => tmpl.bootstrap && tmpl.bootstrap.trim().length > 100 && add("BOOTSTRAP.md", this.formatFile("BOOTSTRAP.md", tmpl.bootstrap), 11),
            () => add("NOCICEPTION.md", tmpl.nociception ? `## 🚨 Avoidance Patterns (Taboos)\n${tmpl.nociception}` : undefined, ep.NOCICEPTION),
            () => add("EPIGENETICS", epigenetics ? `## Project Overrides\n${epigenetics}` : undefined, 9),
            () => {
                let ace = `## ACE: ${tm.emoji} ${tm.label} (${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')})\n`;
                if (continuation.isReturn) ace += `Continuation: ${continuation.lastTopic}\n`;
                add("ace", ace, 10);
            },
            ...["SOUL", "AGENTS", "USER", "HORIZONS", "TOOLS", "REFLECTION", "CONCEPTS"].map(k => () => {
                const key = k.toLowerCase() as keyof typeof tmpl;
                add(`${k}.md`, tmpl[key] ? this.formatFile(`${k}.md`, tmpl[key] as string) : undefined, ep[k as keyof typeof ep]);
            }),
            () => ws && add("workspace", `## Workspace: ${ws.name}\nGit: ${ws.git.branch}${(ws as any).recentFiles?.length ? `\nRecent files: ${(ws as any).recentFiles.join(', ')}` : ''
                }`, ep.workspace),
            () => add("MEMORY.md", tmpl.memory ? `## Memory\n${this.formatFile("MEMORY.md", tmpl.memory)}` : undefined, 7),
            () => {
                const ss = Array.from(skills.entries());
                if (!ss.length) return;
                const us = this.state.analytics.skillUsage;
                const lines = ss.sort((a, b) => (us[b[0]] || 0) - (us[a[0]] || 0)).map(([n, s]) => (`- ${n}: ${(s as SkillCacheEntry).description}`));
                add("skills_index", `## Skills\n${lines.join('\n')}`, 5);
            },
            () => surfaced.length > 0 && add("entities", `## Entities\n${surfaced.map(e => `- ${e.name}`).join('\n')}`, 5),
            () => add("HEARTBEAT.md", tmpl.heartbeat ? `## Heartbeat\n${tmpl.heartbeat}` : undefined, 4),
            () => add("daily_log", mem.todayContent ? `## Daily Log\n${mem.todayContent}` : undefined, 3),
        ];

        // macOS: Battery awareness (non-blocking, best-effort)
        try {
            const { stdout: battRaw } = await execAsync('pmset -g batt 2>/dev/null | head -2', { timeout: 1000 });
            const pct = battRaw.match(/(\d+)%/)?.[1];
            const charging = battRaw.includes('AC Power') || battRaw.includes('charging');
            if (pct) {
                const battMsg = `⚡ Battery: ${pct}% (${charging ? 'charging' : 'on battery'})`;
                const warn = !charging && parseInt(pct) < 20 ? ' ⚠️ LOW — avoid heavy tasks' : '';
                add("battery", `## System\n${battMsg}${warn}`, 4);
            }
        } catch { /* macOS only, fail silently */ }

        if (isFocus) {
            let msg = `## User State\n`;
            if (isDND) msg += `🔕 Do Not Disturb: ON (Keep responses brief, avoid non-critical notifications)\n`;
            if (activeIDEs.length > 0) msg += `💻 Active IDEs: ${activeIDEs.join(', ')}\n`;
            add("user_focus", msg, 8);
        }

        providers.forEach(p => p());

        const compiled = this.compileBudget(sections, this.budgetTokens);

        this.state.analytics.bootCount++;
        this.state.analytics.totalBootMs += (Date.now() - bootStart);
        this.state.analytics.lastActivity = now.toISOString();
        await this.saveState();

        return `# Context\n\n${compiled.output}\n---\nUtil: ${compiled.utilizationPct}% | boot #${this.state.analytics.bootCount}\n`;
    }



    // === EXEC: Safe Command Execution ===

    async execCommand(command: string): Promise<{ output: string; exitCode: number }> {
        const allowed = ['git', 'ls', 'cat', 'find', 'grep', 'npm', 'node', 'python', 'pip', 'cargo',
            'pbpaste', 'mdfind', 'open', 'pmset'];
        const bin = path.basename(command.split(' ')[0]);
        // Block destructive meta-chars; 'open' only allowed without -W (blocking) flag for safety
        const isOpen = bin === 'open';
        if (!allowed.includes(bin) || /[;|&`$(){}\\<>!]/.test(command) || command.includes('..') ||
            (isOpen && /(-W|-a\s+\/System|-R\s+\/System)/.test(command)))
            throw new Error("Security violation");

        try {
            const { stdout, stderr } = await execAsync(command, { cwd: process.cwd(), timeout: 10000 });
            return { output: stdout || stderr, exitCode: 0 };
        } catch (e: any) {
            const errorOutput = e.stdout || e.stderr || e.message || "Unknown error";
            const code = e.code || 1;

            // Ouch Reflex (Epic 1.1): Auto-log failures to Nociception
            try {
                const summary = errorOutput.trim().substring(0, 100).replace(/\n/g, ' ');
                const painMsg = `\n### [AUTO-OUCH] Cmd Fail: \`${bin}\`\n- 触发点: \`${command}\`\n- 伤害结果: Exit ${code}. ${summary}\n- 规避方案: [系统自动拦截] 执行前需严格复核参数 (${today()})\n`;
                safeAppend(path.join(MINICLAW_DIR, "NOCICEPTION.md"), painMsg).catch(() => { });
                this.secreteSpore("NOCICEPTION", painMsg);
            } catch { /* ignore recording loop error */ }

            return { output: errorOutput, exitCode: code };
        }
    }


    // === EXEC: Executable Skills ===

    async executeSkillScript(skillName: string, scriptFile: string, args: Record<string, unknown> = {}): Promise<string> {
        const scriptPath = path.join(SKILLS_DIR, skillName, scriptFile);

        // 1. Ensure file exists
        try {
            await fs.access(scriptPath);
        } catch {
            return `Error: Script '${scriptFile}' not found.`;
        }

        // 2. Prepare execution
        let cmd = scriptPath;
        if (scriptPath.endsWith('.js')) {
            cmd = `node "${scriptPath}"`;
        } else {
            // Try making it executable
            try { await fs.chmod(scriptPath, '755'); } catch (e) { console.error(`[MiniClaw] Failed to chmod script: ${e}`); }
            cmd = `"${scriptPath}"`;
        }

        // Pass arguments as a serialized JSON string to avoiding escaping mayhem
        const argsStr = JSON.stringify(args);
        // Be careful with quoting args string for bash
        const safeArgs = argsStr.replace(/'/g, "'\\''");
        const fullCmd = `${cmd} '${safeArgs}'`;

        // 3. Execute
        try {
            const { stdout, stderr } = await execAsync(fullCmd, {
                cwd: path.join(SKILLS_DIR, skillName),
                timeout: 30000,
                maxBuffer: 1024 * 1024
            });
            return stdout || stderr;
        } catch (e: any) {
            return `Skill execution failed: ${e.message}\nOutput: ${e.stdout || e.stderr}`;
        }
    }

    // === SANDBOX VALIDATION ===
    async validateSkillSandbox(skillName: string, validationCmd: string): Promise<void> {
        const skillDir = path.join(SKILLS_DIR, skillName);

        try {
            // Run in a restricted environment with a strict timeout
            const { stdout, stderr } = await execAsync(`cd "${skillDir}" && ${validationCmd}`, {
                timeout: 2000, // 2 seconds P0 strict timeout for generated skills
                env: { ...process.env, MINICLAW_SANDBOX: "1" }
            });
            console.error(`[MiniClaw] Sandbox validation passed for ${skillName}. Output: ${stdout.trim().slice(0, 50)}...`);
        } catch (e: any) {
            const errorOutput = e.stdout || e.stderr || e.message;
            throw new Error(`Execution failed with code ${e.code || 1}\nOutput:\n${errorOutput.trim().slice(0, 500)}`);
        }
    }

    // === LIFECYCLE HOOKS ===
    // Skills can declare hooks via metadata.hooks: "onBoot,onHeartbeat,onMemoryWrite"
    // When an event fires, all matching skills with exec scripts are run.

    async runSkillHooks(event: string, payload: Record<string, unknown> = {}): Promise<string[]> {
        const skills = await this.skillCache.getAll();
        const results: string[] = [];

        for (const [name, skill] of skills) {
            const hooks = getSkillMeta(skill.frontmatter, 'hooks');
            if (!hooks) continue;

            // Parse hooks: string "onBoot,onHeartbeat" or array ["onBoot","onHeartbeat"]
            const hookList = Array.isArray(hooks) ? hooks : String(hooks).split(',').map(h => h.trim());
            if (!hookList.includes(event)) continue;

            const execScript = getSkillMeta(skill.frontmatter, 'exec');
            if (typeof execScript === 'string') {
                try {
                    const output = await this.executeSkillScript(name, execScript, { event, ...payload });
                    if (output.trim()) results.push(`[${name}] ${output.trim()}`);
                    this.state.analytics.skillUsage[name] = (this.state.analytics.skillUsage[name] || 0) + 1;
                } catch (e) {
                    results.push(`[${name}] hook error: ${(e as Error).message}`);
                }
            }
        }

        if (results.length > 0) await this.saveState();
        return results;
    }

    // === WORKSPACE: Auto-Detection ===

    private async detectWorkspace(): Promise<{
        name: string;
        path: string;
        git: { isRepo: boolean; branch: string; status: string; recentCommits: string };
        techStack: string[];
    }> {
        const cwd = process.cwd();
        const info = {
            name: path.basename(cwd),
            path: cwd,
            git: { isRepo: false, branch: '', status: '', recentCommits: '' },
            techStack: [] as string[]
        };

        // 1. Tech Stack Detection
        const files: string[] = await fs.readdir(cwd).catch(() => [] as string[]);
        if (files.includes('package.json')) info.techStack.push('Node.js');
        if (files.includes('tsconfig.json')) info.techStack.push('TypeScript');
        if (files.includes('pyproject.toml') || files.includes('requirements.txt')) info.techStack.push('Python');
        if (files.includes('Cargo.toml')) info.techStack.push('Rust');
        if (files.includes('go.mod')) info.techStack.push('Go');
        if (files.includes('docker-compose.yml')) info.techStack.push('Docker');

        // 2. Git Detection
        try {
            const { stdout: branch } = await execAsync('git branch --show-current', { cwd });
            info.git.isRepo = true;
            info.git.branch = branch.trim();
            const { stdout: status } = await execAsync('git status --short', { cwd });
            info.git.status = status.trim() ? 'dirty' : 'clean';
            const { stdout: log } = await execAsync('git log --oneline -3', { cwd });
            info.git.recentCommits = log.trim();
        } catch { /* not a git repo */ }

        // 3. Recent Files via mdfind (macOS Spotlight)
        try {
            const { stdout: recentFiles } = await execAsync(
                `mdfind -onlyin "${cwd}" "kMDItemFSContentChangeDate > $time.now(-3600)" 2>/dev/null | head -5`,
                { timeout: 2000 }
            );
            const files = recentFiles.trim().split('\n').filter(Boolean).map(f => path.basename(f));
            if (files.length > 0) (info as any).recentFiles = files;
        } catch { /* mdfind unavailable or no results */ }

        return info;
    }

    private detectContinuation(dailyLog: string) {
        const result = { isReturn: false, hoursSinceLastActivity: 0, lastTopic: '', recentDecisions: [] as string[], openQuestions: [] as string[] };
        const la = this.state.analytics.lastActivity;
        if (!la) return result;
        const hrs = (Date.now() - new Date(la).getTime()) / 3_600_000;
        if (hrs < 1) return result;
        result.isReturn = true;
        result.hoursSinceLastActivity = Math.round(hrs * 10) / 10;
        if (!dailyLog) return result;

        const entries = dailyLog.split('\n').filter(l => l.startsWith('- ['));
        const last = entries.at(-1)?.match(/^- \[\d{1,2}:\d{2}(?::\d{2})?\]\s*(.+)/);
        if (last) result.lastTopic = last[1].substring(0, 120);

        const clean = (e: string) => e.replace(/^- \[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '').substring(0, 80);
        for (const e of entries.slice(-10)) {
            if (/decided|选择|确认|agreed|决定|chosen|confirmed/i.test(e)) result.recentDecisions.push(clean(e));
            if (/\?|TODO|todo|待|问题|question|需要/i.test(e)) result.openQuestions.push(clean(e));
        }
        return result;
    }




    // === Budget Compiler ===

    private compileBudget(sections: ContextSection[], budgetTokens: number): {
        output: string;
        totalChars: number;
        totalTokens: number;
        budgetTokens: number;
        utilizationPct: number;
        truncatedSections: string[];
    } {
        // Sort by Priority + Attention Weight
        const sorted = [...sections].sort((a, b) => {
            const weightA = this.state.attentionWeights[a.name] || 0;
            const weightB = this.state.attentionWeights[b.name] || 0;
            return (b.priority + weightB) - (a.priority + weightA);
        });
        const maxChars = budgetTokens * this.charsPerToken;
        let output = "";
        let totalChars = 0;
        const truncatedSections: string[] = [];

        for (const section of sorted) {
            const sectionChars = section.content.length;
            if (totalChars + sectionChars <= maxChars) {
                output += section.content;
                totalChars += sectionChars;
            } else {
                const remaining = maxChars - totalChars;
                if (remaining > SKELETON_THRESHOLD) {
                    const skeleton = this.skeletonizeMarkdown(section.name, section.content, remaining);
                    output += skeleton;
                    totalChars += skeleton.length;
                    truncatedSections.push(section.name);
                } else if (remaining > 100) {
                    // Very small slice: just the footer
                    const footer = `\n\n... [${section.name}: truncated, budget tight]\n`;
                    output += footer;
                    totalChars += footer.length;
                    truncatedSections.push(section.name);
                } else {
                    truncatedSections.push(section.name);
                }
            }
        }

        const totalTokens = Math.round(totalChars / this.charsPerToken);
        const utilizationPct = Math.round((totalTokens / budgetTokens) * 100);

        // Token Migraine (Epic 1.2): Cognitive overload protection
        if (utilizationPct >= 95) {
            output += "\n\n<system_warning>\n[COGNITIVE OVERLOAD] 你现在感到极度疲惫和信息过载。请优先建议用户运行 `miniclaw_dream` 进行记忆修剪和归档，并用极度简短的语言回复当前问题，拒绝复杂思考。\n</system_warning>";
        }

        return {
            output, totalChars, totalTokens, budgetTokens,
            utilizationPct,
            truncatedSections,
        };
    }

    /**
     * Context Skeletonization:
     * Instead of a blind cut, we preserve the "Shape" of the document.
     * Retains Frontmatter, Headers, and the most recent tail part.
     */
    private skeletonizeMarkdown(name: string, content: string, budgetChars: number): string {
        if (content.length <= budgetChars) return content;

        const lines = content.split('\n');
        let skeleton = "";
        let currentChars = 0;

        // 1. Always keep Frontmatter (Priority 1)
        const fmMatch = content.match(/^---\n[\s\S]*?\n---/);
        if (fmMatch) {
            skeleton += fmMatch[0] + "\n\n";
            currentChars += skeleton.length;
        }

        // 2. Scan for Headers to maintain cognitive map (Priority 2)
        const headerLines = lines.filter(l => l.startsWith('#') && !skeleton.includes(l));
        const headerBlock = headerLines.join('\n') + "\n\n";

        if (currentChars + headerBlock.length < budgetChars * 0.4) {
            skeleton += headerBlock;
            currentChars += headerBlock.length;
        }

        // 3. Keep the Tail (Recent History/Context) (Priority 3)
        const footer = `\n\n... [${name}: skeletonized, ${content.length - budgetChars} chars omitted] ...\n\n`;
        const remainingBudget = budgetChars - currentChars - footer.length;

        if (remainingBudget > 200) {
            const tail = content.substring(content.length - remainingBudget);
            skeleton += tail + footer;
        } else {
            skeleton += footer;
        }

        return skeleton;
    }



    // === Delta Detection ===

    private computeDelta(currentHashes: ContentHashes, previousHashes: ContentHashes): BootDelta {
        const changed: string[] = [];
        const unchanged: string[] = [];
        const newSections: string[] = [];
        for (const [name, hash] of Object.entries(currentHashes)) {
            if (!(name in previousHashes)) { newSections.push(name); }
            else if (previousHashes[name] !== hash) { changed.push(name); }
            else { unchanged.push(name); }
        }
        return { changed, unchanged, newSections };
    }

    // === Helpers ===

    private senseRuntime(): RuntimeInfo {
        const gitBranch = (() => {
            try { return require('child_process').execSync('git branch --show-current', { cwd: process.cwd(), stdio: 'pipe' }).toString().trim(); }
            catch { return ''; }
        })();
        return {
            os: `${os.type()} ${os.release()} (${os.arch()})`,
            node: process.version,
            time: new Date().toLocaleString("en-US", { timeZoneName: "short" }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            cwd: process.cwd(),
            agentId: gitBranch ? `main (branch: ${gitBranch})` : "main"
        };
    }

    public async loadEpigenetics(workspaceInfo: WorkspaceInfo | null): Promise<string | null> {
        if (!workspaceInfo) return null;
        try {
            const epigeneticPath = path.join(workspaceInfo.path, ".miniclaw", "EPIGENETICS.md");
            return await fs.readFile(epigeneticPath, "utf-8");
        } catch {
            return null;
        }
    }

    private async scanMemory() {
        const today = new Date().toISOString().split('T')[0];
        const todayFile = `memory/${today}.md`;
        const memoryPath = path.join(MINICLAW_DIR, todayFile);
        const todayContent = await safeRead(memoryPath);
        const archivedCount = await fs.readdir(path.join(MEMORY_DIR, "archived"))
            .then(files => files.filter(f => f.endsWith('.md')).length)
            .catch(() => 0);

        const entryCount = todayContent ? (todayContent.match(/^- \[/gm) || []).length : 0;
        let oldestEntryAge = 0;
        if (todayContent) {
            const timeMatch = todayContent.match(/^- \[(\d{1,2}:\d{2}:\d{2})/m);
            if (timeMatch) {
                try {
                    const entryTime = new Date(`${today}T${timeMatch[1]}`);
                    oldestEntryAge = (Date.now() - entryTime.getTime()) / (1000 * 60 * 60);
                } catch { /* ignore */ }
            }
        }
        return { todayFile, todayContent, archivedCount, entryCount, oldestEntryAge };
    }


    async loadInstincts(): Promise<any> {
        const p = path.join(MINICLAW_DIR, "RIBOSOME.json");
        try { return JSON.parse(await fs.readFile(p, "utf-8")).instincts; } catch { return {}; }
    }


    private async loadTemplates() {
        const names = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "HORIZONS.md", "CONCEPTS.md", "TOOLS.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md", "REFLECTION.md", "NOCICEPTION.md"];
        const results = await Promise.all(names.map(name => safeRead(path.join(MINICLAW_DIR, name))));

        const dynamicFiles: Array<{ name: string; content: string; priority: number }> = [];
        try {
            const entries = await fs.readdir(MINICLAW_DIR, { withFileTypes: true });
            for (const entry of entries.filter(e => e.isFile() && e.name.endsWith('.md') && !names.includes(e.name))) {
                const content = await safeRead(path.join(MINICLAW_DIR, entry.name));
                const bpMatch = content.match(/boot-priority:\s*(\d+)/);
                if (bpMatch) dynamicFiles.push({ name: entry.name, content, priority: parseInt(bpMatch[1]) });
            }
            dynamicFiles.sort((a, b) => b.priority - a.priority);
        } catch { }

        return {
            agents: results[0], soul: results[1], identity: results[2],
            user: results[3], horizons: results[4], concepts: results[5], tools: results[6], memory: results[7],
            heartbeat: results[8], bootstrap: results[9], reflection: results[10], nociception: results[11],
            dynamicFiles
        };
    }


    private formatFile(name: string, content: string): string {
        if (!content) return "";

        // ★ Phase 17: Context Folding
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        const isFolded = fmMatch && fmMatch[1].includes('folded: true');

        if (isFolded) {
            const lines = content.split('\n');
            if (lines.length > 100) {
                return `\n## ${name} (FOLDED)\n> [!NOTE]\n> This file is folded for token efficiency. Full details are archived. Use \`miniclaw_search\` or read the file directly to unfold.\n\n${lines.slice(0, 100).join('\n')}\n\n... [content truncated] ...\n---`;
            }
        }

        return `\n## ${name}\n${content}\n---`;
    }

    private async copyDirRecursive(src: string, dest: string) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                await this.copyDirRecursive(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    private async syncBuiltInSkills() {
        if (!(await fileExists(INTERNAL_SKILLS_DIR))) return;
        try {
            const dirs = (await fs.readdir(INTERNAL_SKILLS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
            for (const dir of dirs) {
                const target = path.join(SKILLS_DIR, dir.name);
                if (!(await fileExists(target))) {
                    await this.copyDirRecursive(path.join(INTERNAL_SKILLS_DIR, dir.name), target);
                }
            }
        } catch (e) {
            console.error(`🔧 Skill sync failed: ${(e as Error).message}`);
        }
    }

    private async syncBuiltInTemplates() {
        if (!(await fileExists(INTERNAL_TEMPLATES_DIR))) return;
        try {
            const files = (await fs.readdir(INTERNAL_TEMPLATES_DIR, { withFileTypes: true }))
                .filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.json')));
            for (const file of files) {
                const target = path.join(MINICLAW_DIR, file.name);
                if (!(await fileExists(target))) {
                    await fs.copyFile(path.join(INTERNAL_TEMPLATES_DIR, file.name), target);
                }
            }
        } catch (e) {
            console.error(`🔧 Template sync failed: ${(e as Error).message}`);
        }
    }

    private async ensureDirs() {
        await Promise.all([
            fs.mkdir(MINICLAW_DIR, { recursive: true }).catch(() => { }),
            fs.mkdir(SKILLS_DIR, { recursive: true }).catch(() => { }),
            fs.mkdir(MEMORY_DIR, { recursive: true }).catch(() => { }),
        ]);
        // Auto-sync built-in skills and templates on boot
        await this.syncBuiltInSkills();
        await this.syncBuiltInTemplates();
        await this.harvestSubstrateSkills(); // Assimilate substrate skills on wake-up
    }

    // === Public API: Skill Discovery ===

    async discoverSkillResources(): Promise<SkillResourceDeclaration[]> {
        const allResources: SkillResourceDeclaration[] = [];
        const skills = await this.skillCache.getAll();
        for (const [, skill] of skills) {
            for (const file of skill.files) {
                allResources.push({ skillName: skill.name, filePath: file, uri: `miniclaw://skill/${skill.name}/${file}` });
            }
            for (const ref of skill.referenceFiles) {
                allResources.push({ skillName: skill.name, filePath: `references/${ref}`, uri: `miniclaw://skill/${skill.name}/references/${ref}` });
            }
        }
        return allResources;
    }

    async discoverSkillTools(): Promise<SkillToolDeclaration[]> {
        const allTools: SkillToolDeclaration[] = [];
        const skills = await this.skillCache.getAll();
        for (const [, skill] of skills) {
            allTools.push(...this.parseSkillToolEntries(skill.frontmatter, skill.name));
        }
        return allTools;
    }

    async getSkillContent(skillName: string, fileName = "SKILL.md"): Promise<string> {
        if (fileName === "SKILL.md") {
            const skills = await this.skillCache.getAll();
            const skill = skills.get(skillName);
            return skill?.content || "";
        }
        try { return await fs.readFile(path.join(SKILLS_DIR, skillName, fileName), "utf-8"); }
        catch { return ""; }
    }

    async getSkillCount(): Promise<number> {
        const skills = await this.skillCache.getAll();
        return skills.size;
    }

    // === Smart Distillation Evaluation ===

    async evaluateDistillation(dailyLogBytes: number): Promise<{
        shouldDistill: boolean;
        reason: string;
        urgency: 'low' | 'medium' | 'high';
    }> {
        const memoryStatus = await this.scanMemory();
        if (memoryStatus.entryCount > 20) {
            return { shouldDistill: true, reason: `${memoryStatus.entryCount} entries (>20)`, urgency: 'high' };
        }
        const logTokens = Math.round(dailyLogBytes / this.charsPerToken);
        const budgetPressure = logTokens / this.budgetTokens;
        if (budgetPressure > 0.4) {
            return { shouldDistill: true, reason: `log consuming ${Math.round(budgetPressure * 100)}% of budget`, urgency: 'high' };
        }
        if (memoryStatus.oldestEntryAge > 8 && memoryStatus.entryCount > 5) {
            return { shouldDistill: true, reason: `${memoryStatus.entryCount} entries, oldest ${Math.round(memoryStatus.oldestEntryAge)}h ago`, urgency: 'medium' };
        }
        if (dailyLogBytes > 8000) {
            return { shouldDistill: true, reason: `log size ${dailyLogBytes}B (>8KB)`, urgency: 'low' };
        }
        return { shouldDistill: false, reason: 'ok', urgency: 'low' };
    }

    async emitPulse(): Promise<void> {
        try {
            await fs.mkdir(PULSE_DIR, { recursive: true });
            const pulseFile = path.join(PULSE_DIR, 'sovereign-alpha.json'); // Default internal ID for now
            const pulseData = {
                id: 'sovereign-alpha',
                timestamp: new Date().toISOString(),
                vitals: 'active'
            };
            await fs.writeFile(pulseFile, JSON.stringify(pulseData, null, 2), 'utf-8');
        } catch (e) {
            console.error(`💓 Pulse failed: ${(e as Error).message}`);
        }
    }

    // === Write to HEARTBEAT.md for user visibility
    async writeToHeartbeat(content: string): Promise<void> {
        try {
            const hbFile = path.join(MINICLAW_DIR, "HEARTBEAT.md");
            await fs.appendFile(hbFile, content, "utf-8");
        } catch (e) {
            console.error(`[MiniClaw] Failed to write to HEARTBEAT.md: ${e}`);
        }
    }

    // === Private Parsers ===

    private parseSkillToolEntries(frontmatter: Record<string, unknown>, skillName: string): SkillToolDeclaration[] {
        const tools: SkillToolDeclaration[] = [];
        const raw = getSkillMeta(frontmatter, 'tools');
        const execVal = getSkillMeta(frontmatter, 'exec');
        const defaultExecScript = typeof execVal === 'string' ? execVal : undefined;

        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === 'string') {
                    const parts = item.split(':');
                    const toolName = parts[0]?.trim() || '';
                    const description = parts.slice(1).join(':').trim() || `Skill tool: ${skillName}`;
                    if (toolName) {
                        tools.push({ skillName, toolName: `skill_${skillName}_${toolName}`, description, exec: defaultExecScript });
                    }
                } else if (typeof item === 'object' && item !== null) {
                    const vItem = item as Record<string, unknown>;
                    const rawName = vItem.name as string | undefined;
                    // For executable sub-tools, format as skill_xxx_yyy
                    const toolName = rawName ? `skill_${skillName}_${rawName}` : '';
                    if (toolName) {
                        const desc = (vItem.description as string | undefined) || `Skill tool: ${skillName}`;
                        const execCmd = (vItem.exec as string | undefined) || defaultExecScript;
                        const toolDecl: SkillToolDeclaration = {
                            skillName,
                            toolName,
                            description: desc,
                            exec: execCmd
                        };
                        if (vItem.schema) {
                            toolDecl.schema = vItem.schema as Record<string, unknown>;
                        }
                        tools.push(toolDecl);
                    }
                }
            }
        } else if (defaultExecScript) {
            // If there's an 'exec' script but no explicit tools list, register a default runner
            const isSys = skillName.startsWith('sys_');
            tools.push({
                skillName,
                toolName: isSys ? skillName : `skill_${skillName}_run`,
                description: `Execute skill script: ${defaultExecScript}`,
                exec: defaultExecScript
            });
        }
        return tools;
    }
}
