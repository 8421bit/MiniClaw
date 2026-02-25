
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { parseFrontmatter, hashString, atomicWrite } from "./utils.js";

const execAsync = promisify(exec);

// --- Configuration & Constants ---
const HOME_DIR = process.env.HOME || process.cwd();
export const MINICLAW_DIR = path.join(HOME_DIR, ".miniclaw");
const SKILLS_DIR = path.join(MINICLAW_DIR, "skills");
const MEMORY_DIR = path.join(MINICLAW_DIR, "memory");
const STATE_FILE = path.join(MINICLAW_DIR, "state.json");
const ENTITIES_FILE = path.join(MINICLAW_DIR, "entities.json");

// Context budget (configurable via env)
const DEFAULT_TOKEN_BUDGET = parseInt(process.env.MINICLAW_TOKEN_BUDGET || "8000", 10);
const CHARS_PER_TOKEN = 4;

// --- Interfaces ---
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
}

// --- Skill Types ---
export interface SkillPromptDeclaration {
    skillName: string;
    promptName: string;
    description: string;
}

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
    exec?: string; // SCRIPT TO EXECUTE
}

// --- Context Section (for budget management) ---
interface ContextSection {
    name: string;
    content: string;
    priority: number; // 1-10, higher = keep first
}

// --- Skill Cache Entry ---
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

// --- Content Hash State ---
export interface ContentHashes {
    [sectionName: string]: string;
}

export interface BootDelta {
    changed: string[];
    unchanged: string[];
    newSections: string[];
}

// --- ACE: Time Modes ---
type TimeMode = "morning" | "work" | "break" | "evening" | "night";

interface TimeModeConfig {
    emoji: string;
    label: string;
    briefing: boolean;    // show morning briefing
    reflective: boolean;  // suggest distillation/review
    minimal: boolean;     // reduce context
}

const TIME_MODES: Record<TimeMode, TimeModeConfig> = {
    morning: { emoji: "☀️", label: "Morning", briefing: true, reflective: false, minimal: false },
    work: { emoji: "💼", label: "Work", briefing: false, reflective: false, minimal: false },
    break: { emoji: "🍜", label: "Break", briefing: false, reflective: false, minimal: false },
    evening: { emoji: "🌙", label: "Evening", briefing: false, reflective: true, minimal: false },
    night: { emoji: "😴", label: "Night", briefing: false, reflective: false, minimal: true },
};

// --- Entity Types ---
export interface Entity {
    name: string;
    type: "person" | "project" | "tool" | "concept" | "place" | "other";
    attributes: Record<string, string>;
    relations: string[];
    firstMentioned: string;
    lastMentioned: string;
    mentionCount: number;
}

// --- Analytics Types ---
export interface Analytics {
    toolCalls: Record<string, number>;
    promptsUsed: Record<string, number>;
    bootCount: number;
    totalBootMs: number;
    lastActivity: string;
    skillUsage: Record<string, number>;
    dailyDistillations: number;
}

// --- Persistent State ---
interface HeartbeatState {
    lastHeartbeat: string | null;
    lastDistill: string | null;
    needsDistill: boolean;
    dailyLogBytes: number;
}

interface MiniClawState {
    analytics: Analytics;
    previousHashes: ContentHashes;
    heartbeat: HeartbeatState;
}

const DEFAULT_HEARTBEAT: HeartbeatState = {
    lastHeartbeat: null,
    lastDistill: null,
    needsDistill: false,
    dailyLogBytes: 0,
};

// === Skill Cache (Solves N+1 problem) ===

class SkillCache {
    private cache: Map<string, SkillCacheEntry> = new Map();
    private lastScanTime = 0;
    private readonly TTL_MS = 5000;

    async getAll(): Promise<Map<string, SkillCacheEntry>> {
        const now = Date.now();
        if (this.cache.size > 0 && (now - this.lastScanTime) < this.TTL_MS) {
            return this.cache;
        }
        await this.refresh();
        return this.cache;
    }

    invalidate(): void {
        this.lastScanTime = 0;
    }

    private async refresh(): Promise<void> {
        const newCache = new Map<string, SkillCacheEntry>();
        try {
            const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
            const dirs = entries.filter(e => e.isDirectory());
            const results = await Promise.all(dirs.map(async (dir) => {
                const skillDir = path.join(SKILLS_DIR, dir.name);
                try {
                    const [content, files, refFiles] = await Promise.all([
                        fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8").catch(() => ""),
                        fs.readdir(skillDir).catch(() => [] as string[]),
                        fs.readdir(path.join(skillDir, "references")).catch(() => [] as string[]),
                    ]);
                    const frontmatter = parseFrontmatter(content);
                    let description = "";
                    if (typeof frontmatter['description'] === 'string') {
                        description = frontmatter['description'];
                    } else {
                        const lines = content.split('\n');
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
                                description = trimmed.substring(0, 100) + (trimmed.length > 100 ? "..." : "");
                                break;
                            }
                        }
                    }
                    return {
                        name: dir.name, content, frontmatter, description,
                        files: files.filter(f => f.endsWith('.md') || f.endsWith('.json')),
                        referenceFiles: refFiles.filter(f => f.endsWith('.md') || f.endsWith('.json')),
                    } as SkillCacheEntry;
                } catch { return null; }
            }));
            for (const result of results) {
                if (result) newCache.set(result.name, result);
            }
        } catch { /* skills dir doesn't exist yet */ }
        this.cache = newCache;
        this.lastScanTime = Date.now();
    }
}

// === Entity Store ===

class EntityStore {
    private entities: Entity[] = [];
    private loaded = false;

    async load(): Promise<void> {
        if (this.loaded) return;
        try {
            const raw = await fs.readFile(ENTITIES_FILE, "utf-8");
            const data = JSON.parse(raw);
            this.entities = Array.isArray(data.entities) ? data.entities : [];
        } catch {
            this.entities = [];
        }
        this.loaded = true;
    }

    async save(): Promise<void> {
        await atomicWrite(ENTITIES_FILE, JSON.stringify({ entities: this.entities }, null, 2));
    }

    async add(entity: Omit<Entity, "firstMentioned" | "lastMentioned" | "mentionCount">): Promise<Entity> {
        await this.load();
        const now = new Date().toISOString().split('T')[0];
        const existing = this.entities.find(e => e.name.toLowerCase() === entity.name.toLowerCase());
        if (existing) {
            existing.lastMentioned = now;
            existing.mentionCount++;
            // Merge attributes and relations
            Object.assign(existing.attributes, entity.attributes);
            for (const rel of entity.relations) {
                if (!existing.relations.includes(rel)) existing.relations.push(rel);
            }
            await this.save();
            return existing;
        }
        const newEntity: Entity = {
            ...entity,
            firstMentioned: now,
            lastMentioned: now,
            mentionCount: 1,
        };
        this.entities.push(newEntity);
        await this.save();
        return newEntity;
    }

    async remove(name: string): Promise<boolean> {
        await this.load();
        const idx = this.entities.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
        if (idx === -1) return false;
        this.entities.splice(idx, 1);
        await this.save();
        return true;
    }

    async link(name: string, relation: string): Promise<boolean> {
        await this.load();
        const entity = this.entities.find(e => e.name.toLowerCase() === name.toLowerCase());
        if (!entity) return false;
        if (!entity.relations.includes(relation)) {
            entity.relations.push(relation);
            entity.lastMentioned = new Date().toISOString().split('T')[0];
            await this.save();
        }
        return true;
    }

    async query(name: string): Promise<Entity | null> {
        await this.load();
        return this.entities.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
    }

    async list(type?: string): Promise<Entity[]> {
        await this.load();
        if (type) return this.entities.filter(e => e.type === type);
        return [...this.entities];
    }

    async getCount(): Promise<number> {
        await this.load();
        return this.entities.length;
    }

    /**
     * Surface entities mentioned in text (for auto-injection during boot).
     * Returns entities whose names appear in the given text.
     */
    async surfaceRelevant(text: string): Promise<Entity[]> {
        await this.load();
        if (!text || this.entities.length === 0) return [];
        const lowerText = text.toLowerCase();
        return this.entities
            .filter(e => lowerText.includes(e.name.toLowerCase()))
            .sort((a, b) => b.mentionCount - a.mentionCount)
            .slice(0, 5); // Max 5 surfaced entities
    }
}


function getTimeMode(hour: number): TimeMode {
    if (hour >= 6 && hour < 9) return "morning";
    if (hour >= 9 && hour < 12) return "work";
    if (hour >= 12 && hour < 14) return "break";
    if (hour >= 14 && hour < 18) return "work";
    if (hour >= 18 && hour < 22) return "evening";
    return "night";
}

// === The Kernel ===

export class ContextKernel {
    private skillCache = new SkillCache();
    readonly entityStore = new EntityStore();
    private bootErrors: string[] = [];
    private state: MiniClawState = {
        analytics: {
            toolCalls: {}, promptsUsed: {}, bootCount: 0,
            totalBootMs: 0, lastActivity: "", skillUsage: {},
            dailyDistillations: 0,
        },
        previousHashes: {},
        heartbeat: { ...DEFAULT_HEARTBEAT },
    };
    private stateLoaded = false;

    // --- State Persistence ---

    private async loadState(): Promise<void> {
        if (this.stateLoaded) return;
        try {
            const raw = await fs.readFile(STATE_FILE, "utf-8");
            const data = JSON.parse(raw);
            if (data.analytics) this.state.analytics = { ...this.state.analytics, ...data.analytics };
            if (data.previousHashes) this.state.previousHashes = data.previousHashes;
            if (data.heartbeat) this.state.heartbeat = { ...DEFAULT_HEARTBEAT, ...data.heartbeat };
        } catch { /* first run, use defaults */ }
        this.stateLoaded = true;
    }

    private async saveState(): Promise<void> {
        await atomicWrite(STATE_FILE, JSON.stringify(this.state, null, 2));
    }

    // --- Analytics API ---

    // --- Heartbeat State API (unified state) ---

    async getHeartbeatState(): Promise<HeartbeatState> {
        await this.loadState();
        return { ...this.state.heartbeat };
    }

    async updateHeartbeatState(updates: Partial<HeartbeatState>): Promise<void> {
        await this.loadState();
        Object.assign(this.state.heartbeat, updates);
        await this.saveState();
    }

    async trackTool(toolName: string): Promise<void> {
        await this.loadState();
        this.state.analytics.toolCalls[toolName] = (this.state.analytics.toolCalls[toolName] || 0) + 1;
        this.state.analytics.lastActivity = new Date().toISOString();
        await this.saveState();
    }

    async trackPrompt(promptName: string): Promise<void> {
        await this.loadState();
        this.state.analytics.promptsUsed[promptName] = (this.state.analytics.promptsUsed[promptName] || 0) + 1;
        await this.saveState();
    }

    async getAnalytics(): Promise<Analytics> {
        await this.loadState();
        return { ...this.state.analytics };
    }

    /**
     * Boot the kernel and assemble the context.
     * Living Agent v0.5 "The Nervous System":
     * - ACE (Time, Continuation)
     * - Workspace Auto-Detection (Project, Git, Files)
     * - Entity Surfacing
     * - Budget Management
     */
    async boot(mode: ContextMode = { type: "full" }): Promise<string> {
        this.bootErrors = [];
        const bootStart = Date.now();

        // 1. Initialize environment + load state
        await Promise.all([
            this.ensureDirs(),
            this.loadState(),
            this.entityStore.load(),
        ]);

        // --- MODE: MINIMAL (Sub-Agent) ---
        if (mode.type === "minimal") {
            const templates = await this.loadTemplates();
            const runtime = this.senseRuntime();
            let context = `# Subagent Context\n\n`;
            if (templates.subagent) {
                context += `${templates.subagent}\n\n`;
            } else {
                context += `You are a subagent. Focus on the task. No side effects.\n\n`;
            }
            context += `## Runtime\n`;
            context += `Runtime: agent=subagent | host=${os.hostname()} | os=${runtime.os} | node=${runtime.node}\n`;
            context += `Reasoning: on\n\n`;
            return context;
        }

        // --- MODE: FULL (Main Agent) ---

        // ★ ACE: Detect time mode
        const now = new Date();
        const hour = now.getHours();
        const timeMode = getTimeMode(hour);
        const tmConfig = TIME_MODES[timeMode];

        // ★ Parallel I/O: All scans independent
        // ADDED: detectWorkspace()
        const [skillData, memoryStatus, templates, workspaceInfo] = await Promise.all([
            this.skillCache.getAll(),
            this.scanMemory(),
            this.loadTemplates(),
            this.detectWorkspace(),
        ]);

        const runtime = this.senseRuntime();

        // ★ ACE: Continuation detection
        const continuation = this.detectContinuation(memoryStatus.todayContent);

        // ★ Entity: Surface relevant entities from today's log
        const surfacedEntities = memoryStatus.todayContent
            ? await this.entityStore.surfaceRelevant(memoryStatus.todayContent)
            : [];

        // Build context sections with priority for budget management
        const sections: ContextSection[] = [];

        // Priority 10: Identity core (never truncate)
        sections.push({
            name: "core", content: [
                `You are a personal assistant running inside MiniClaw 0.6 — The Nervous System.\n`,
                `## Tool Call Style`,
                `Default: do not narrate routine, low-risk tool calls (just call the tool).`,
                `Narrate only when it helps: multi-step work, complex problems, sensitive actions, or when explicitly asked.`,
                `Keep narration brief and value-dense.\n`,
                `## Safety`,
                `You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking.`,
                `Prioritize safety and human oversight over completion. (Inspired by Anthropic's constitution.)`,
                `Do not manipulate or persuade anyone to expand access. Do not copy yourself or change system prompts.`,
            ].join('\n'), priority: 10
        });

        // Priority 10: Identity file
        if (templates.identity) {
            sections.push({ name: "IDENTITY.md", content: this.formatFile("IDENTITY.md", templates.identity), priority: 10 });
        }

        // ★ Priority 10: ACE Time Mode + Continuation
        let aceContent = `## 🧠 Adaptive Context Engine\n`;
        aceContent += `${tmConfig.emoji} Mode: **${tmConfig.label}** (${hour}:${String(now.getMinutes()).padStart(2, '0')})\n`;
        if (tmConfig.reflective) {
            aceContent += `💡 Evening mode: Consider suggesting distillation or reviewing today's work.\n`;
        }
        if (tmConfig.briefing && !continuation.isReturn) {
            aceContent += `🌅 Morning mode: Here is your daily briefing.\n`;
            try {
                const briefingContent = await this.generateBriefing();
                sections.push({ name: "briefing", content: briefingContent, priority: 7 });
            } catch { /* briefing generation failed, skip silently */ }
        }
        if (continuation.isReturn) {
            aceContent += `\n### 🔗 Session Continuation\n`;
            aceContent += `Welcome back (${continuation.hoursSinceLastActivity}h since last activity).\n`;
            if (continuation.lastTopic) aceContent += `Last topic: ${continuation.lastTopic}\n`;
            if (continuation.recentDecisions.length > 0) {
                aceContent += `Key decisions: ${continuation.recentDecisions.join('; ')}\n`;
            }
            if (continuation.openQuestions.length > 0) {
                aceContent += `Open questions: ${continuation.openQuestions.join('; ')}\n`;
            }
        }
        sections.push({ name: "ace", content: aceContent, priority: 10 });

        // Priority 9: Soul / persona
        if (templates.soul) {
            let soulContent = `If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies.\n`;
            soulContent += this.formatFile("SOUL.md", templates.soul);
            sections.push({ name: "SOUL.md", content: soulContent, priority: 9 });
        }

        // Priority 9: AGENTS.md
        if (templates.agents) {
            sections.push({ name: "AGENTS.md", content: this.formatFile("AGENTS.md", templates.agents), priority: 9 });
        }

        // Priority 8: User profile
        if (templates.user) {
            sections.push({ name: "USER.md", content: this.formatFile("USER.md", templates.user), priority: 8 });
        }

        // Priority 7: Long-term memory
        if (templates.memory) {
            sections.push({ name: "MEMORY.md", content: `## Memory Recall\nBefore answering about prior work, decisions, or preferences: check MEMORY.md below.\nUse \`miniclaw_search\` to scan \`${MINICLAW_DIR}\` for deeper searches.\n\n` + this.formatFile("MEMORY.md", templates.memory), priority: 7 });
        }

        // ★ Priority 6: Workspace Intelligence (NEW)
        if (workspaceInfo) {
            let wsContent = `## 👁️ Workspace Awareness\n`;
            wsContent += `**Project**: ${workspaceInfo.name}\n`;
            wsContent += `**Path**: \`${workspaceInfo.path}\`\n`;
            if (workspaceInfo.git.isRepo) {
                wsContent += `**Git**: ${workspaceInfo.git.branch} | ${workspaceInfo.git.status}\n`;
                if (workspaceInfo.git.recentCommits) wsContent += `Recent: ${workspaceInfo.git.recentCommits}\n`;
            }
            if (workspaceInfo.techStack.length > 0) {
                wsContent += `**Stack**: ${workspaceInfo.techStack.join(', ')}\n`;
            }
            sections.push({ name: "workspace", content: wsContent, priority: 6 });
        }

        // Priority 6: Tools
        if (templates.tools) {
            sections.push({ name: "TOOLS.md", content: this.formatFile("TOOLS.md", templates.tools), priority: 6 });
        }

        // Priority 5: Skills index
        if (skillData.size > 0) {
            const skillEntries = Array.from(skillData.entries());
            const usage = this.state.analytics.skillUsage;
            skillEntries.sort((a, b) => (usage[b[0]] || 0) - (usage[a[0]] || 0));

            const skillLines = skillEntries.map(([name, skill]) => {
                const count = usage[name];
                const freq = count ? ` (used ${count}x)` : '';
                const desc = skill.description || "";
                // Mark executable skills
                const execBadge = getSkillMeta(skill.frontmatter, 'exec') ? ` [⚡EXEC]` : ``;
                return `- [${name}]${execBadge}: ${desc}${freq}`;
            });

            let skillContent = `## Skills (mandatory)\n`;
            skillContent += `Before replying: scan <available_skills> entries below.\n`;
            skillContent += `- If exactly one skill clearly applies: read its SKILL.md use tool \`miniclaw_read\`.`;
            skillContent += `- If multiple apply: choose most specific one, then read/follow.\n`;
            skillContent += `<available_skills>\n${skillLines.join("\n")}\n</available_skills>\n`;
            sections.push({ name: "skills_index", content: skillContent, priority: 5 });

            // Skill context hooks
            const hookSections: string[] = [];
            for (const [, skill] of skillData) {
                const ctx = getSkillMeta(skill.frontmatter, 'context');
                if (typeof ctx === 'string' && ctx.trim()) {
                    hookSections.push(`### ${skill.name}\n${ctx}`);
                }
            }
            if (hookSections.length > 0) {
                sections.push({
                    name: "skill_context",
                    content: `## Skill Context (Auto-Injected)\n${hookSections.join("\n\n")}\n`,
                    priority: 5,
                });
            }
        }

        // Priority 5: Entity Memory
        if (surfacedEntities.length > 0) {
            let entityContent = `## 🕸️ Related Entities (Auto-Surfaced)\n`;
            for (const e of surfacedEntities) {
                const attrs = Object.entries(e.attributes).map(([k, v]) => `${k}: ${v}`).join(', ');
                entityContent += `- **${e.name}** (${e.type}, ${e.mentionCount} mentions)`;
                if (attrs) entityContent += `: ${attrs}`;
                if (e.relations.length > 0) entityContent += `\n  Relations: ${e.relations.join('; ')}`;
                entityContent += `\n`;
            }
            sections.push({ name: "entities", content: entityContent, priority: 5 });
        }

        sections.push({ name: "runtime", content: `## Runtime\nRuntime: agent=${runtime.agentId} | host=${os.hostname()} | os=${runtime.os} | node=${runtime.node} | time=${runtime.time}\nReasoning: off (hidden unless on/stream). Toggle /reasoning.\n\n## Silent Replies\nWhen you have nothing to say, respond with ONLY: NO_REPLY\n\n## Heartbeats\nHeartbeat prompt: Check for updates\nIf nothing needs attention, reply exactly: HEARTBEAT_OK\n`, priority: 5 });

        // Priority 4: Heartbeat
        if (templates.heartbeat) {
            sections.push({
                name: "HEARTBEAT.md",
                content: `\n---\n\n## 💓 HEARTBEAT.md (Active Checkups)\n${templates.heartbeat}\n`,
                priority: 4,
            });
        }

        // Priority 4: Lifecycle Hooks (onBoot)
        try {
            const hookResults = await this.runSkillHooks("onBoot");
            if (hookResults.length > 0) {
                sections.push({ name: "hooks_onBoot", content: `## ⚡ Skill Hooks (onBoot)\n${hookResults.join('\n')}\n`, priority: 4 });
            }
        } catch { /* hooks should never break boot */ }

        // Priority 3: Daily log
        if (memoryStatus.todayContent) {
            sections.push({
                name: "daily_log",
                content: `\n---\n\n## 📅 DAILY LOG: ${memoryStatus.todayFile} (Pending Distillation)\n${memoryStatus.todayContent}\n`,
                priority: 3,
            });
        }

        // Priority 2: Bootstrap
        if (templates.bootstrap) {
            sections.push({
                name: "BOOTSTRAP.md",
                content: `\n---\n\n## 👶 BOOTSTRAP.md (FIRST RUN)\n${templates.bootstrap}\n`,
                priority: 2,
            });
        }

        // ★ Context Budget Manager
        const compiled = this.compileBudget(sections, DEFAULT_TOKEN_BUDGET);

        // ★ Content Hash Delta Detection
        const currentHashes: ContentHashes = {};
        for (const section of sections) {
            currentHashes[section.name] = hashString(section.content);
        }
        const delta = this.computeDelta(currentHashes, this.state.previousHashes);
        this.state.previousHashes = currentHashes;

        // ★ Analytics: track boot
        this.state.analytics.bootCount++;
        const bootMs = Date.now() - bootStart;
        this.state.analytics.totalBootMs += bootMs;
        this.state.analytics.lastActivity = new Date().toISOString();
        await this.saveState();

        // --- Final assembly ---
        let context = `# Project Context\n\n`;
        context += `The following project context files have been loaded:\n\n`;
        context += compiled.output;

        // Boot footer
        const avgBootMs = Math.round(this.state.analytics.totalBootMs / this.state.analytics.bootCount);
        context += `\n---\n`;
        context += `${tmConfig.emoji} ${tmConfig.label} | `;
        context += `📏 ~${compiled.totalTokens}/${compiled.budgetTokens} tokens (${compiled.utilizationPct}%)`;
        if (compiled.truncatedSections.length > 0) {
            context += ` | ✂️ ${compiled.truncatedSections.join(', ')}`;
        }
        if (memoryStatus.archivedCount > 0) {
            context += ` | 📚 ${memoryStatus.archivedCount} archived`;
        }
        const entityCount = await this.entityStore.getCount();
        if (entityCount > 0) {
            context += ` | 🕸️ ${entityCount} entities`;
        }
        context += ` | ⚡ ${bootMs}ms (avg ${avgBootMs}ms) | 🔄 boot #${this.state.analytics.bootCount}`;

        // Delta report
        if (delta.changed.length > 0 || delta.newSections.length > 0) {
            const changes: string[] = [];
            if (delta.changed.length > 0) changes.push(`✏️ ${delta.changed.join(', ')}`);
            if (delta.newSections.length > 0) changes.push(`🆕 ${delta.newSections.join(', ')}`);
            context += `\n📊 ${changes.join(' | ')}`;
        }

        // ★ Self-Evolution: File health warnings
        const healthWarnings = await this.checkFileHealth();
        if (healthWarnings.length > 0) {
            context += `\n🏥 ${healthWarnings.join(' | ')}`;
        }

        // Error report
        if (this.bootErrors.length > 0) {
            context += `\n⚠️ Errors (${this.bootErrors.length}): ${this.bootErrors.slice(0, 3).join('; ')}`;
        }

        context += `\n`;
        return context;
    }

    // === EXEC: Safe Command Execution ===

    async execCommand(command: string): Promise<{ output: string; exitCode: number }> {
        // Security: Whitelist of allowed basic commands
        // We prevent dangerous ops like rm, sudo, chown, etc.
        const allowedCommands = [
            'git', 'ls', 'cat', 'find', 'grep', 'head', 'tail', 'wc',
            'echo', 'date', 'uname', 'which', 'pwd', 'ps',
            'npm', 'node', 'pnpm', 'yarn', 'cargo', 'go', 'python', 'python3', 'pip',
            'make', 'cmake', 'tree', 'du'
        ];

        // P0 Fix #1: Always check basename to prevent /bin/rm bypass
        const firstToken = command.split(' ')[0];
        const basename = path.basename(firstToken);
        if (!allowedCommands.includes(basename)) {
            throw new Error(`Command '${basename}' is not in the allowed whitelist.`);
        }

        // P0 Fix #2: Block shell metacharacters to prevent injection
        const dangerousChars = /[;|&`$(){}\\<>!\n]/;
        if (dangerousChars.test(command)) {
            throw new Error(`Command contains disallowed shell metacharacters.`);
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: process.cwd(),
                timeout: 10000,
                maxBuffer: 1024 * 1024 // 1MB output limit
            });
            return { output: stdout || stderr, exitCode: 0 };
        } catch (e: any) {
            return {
                output: e.stdout || e.stderr || e.message,
                exitCode: e.code || 1
            };
        }
    }

    // === EXEC: Executable Skills ===

    async executeSkillScript(skillName: string, scriptFile: string): Promise<string> {
        const scriptPath = path.join(SKILLS_DIR, skillName, scriptFile);

        // 1. Ensure file exists and is executable
        try {
            await fs.access(scriptPath, fs.constants.X_OK);
        } catch {
            try {
                // Try adding execution permission if missing
                await fs.chmod(scriptPath, '755');
            } catch {
                return `Error: Script '${scriptFile}' not found or not executable.`;
            }
        }

        // 2. Execute
        try {
            const { stdout, stderr } = await execAsync(scriptPath, {
                cwd: process.cwd(),
                timeout: 30000
            });
            return stdout || stderr;
        } catch (e: any) {
            return `Skill execution failed: ${e.message}\nOutput: ${e.stdout || e.stderr}`;
        }
    }

    // === LIFECYCLE HOOKS ===
    // Skills can declare hooks via metadata.hooks: "onBoot,onHeartbeat,onMemoryWrite"
    // When an event fires, all matching skills with exec scripts are run.

    async runSkillHooks(event: string): Promise<string[]> {
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
                    const output = await this.executeSkillScript(name, execScript);
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

        return info;
    }

    // === ACE: Continuation Detection ===

    private detectContinuation(dailyLog: string): {
        isReturn: boolean;
        hoursSinceLastActivity: number;
        lastTopic: string;
        recentDecisions: string[];
        openQuestions: string[];
    } {
        const result = {
            isReturn: false,
            hoursSinceLastActivity: 0,
            lastTopic: "",
            recentDecisions: [] as string[],
            openQuestions: [] as string[],
        };

        // Check if there's a gap since last activity
        const lastActivity = this.state.analytics.lastActivity;
        if (!lastActivity) return result;

        const hoursSince = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60);
        if (hoursSince < 1) return result; // Less than 1 hour, not a "return"

        result.isReturn = true;
        result.hoursSinceLastActivity = Math.round(hoursSince * 10) / 10;

        if (!dailyLog) return result;

        // Extract last topic: find the last substantial log entry
        const entries = dailyLog.split('\n').filter(l => l.startsWith('- ['));
        if (entries.length > 0) {
            const lastEntry = entries[entries.length - 1];
            // Remove timestamp prefix like "- [14:30:00] "
            const topicMatch = lastEntry.match(/^- \[\d{1,2}:\d{2}(?::\d{2})?\]\s*(.+)/);
            if (topicMatch) {
                result.lastTopic = topicMatch[1].substring(0, 120);
            }
        }

        // Extract decisions: lines containing "decided", "选择", "确认", "agreed"
        const decisionPatterns = /decided|选择|确认|agreed|决定|chosen|confirmed/i;
        for (const entry of entries.slice(-10)) { // Last 10 entries
            if (decisionPatterns.test(entry)) {
                const clean = entry.replace(/^- \[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '').substring(0, 80);
                result.recentDecisions.push(clean);
            }
        }

        // Extract open questions: lines containing "?", "TODO", "待"
        const questionPatterns = /\?|TODO|todo|待|问题|question|需要/i;
        for (const entry of entries.slice(-10)) {
            if (questionPatterns.test(entry)) {
                const clean = entry.replace(/^- \[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '').substring(0, 80);
                result.openQuestions.push(clean);
            }
        }

        return result;
    }

    // === Self-Evolution: File Health Check ===

    private async checkFileHealth(): Promise<string[]> {
        const warnings: string[] = [];
        const now = Date.now();
        const files = ["MEMORY.md", "USER.md", "SOUL.md"];

        const results = await Promise.all(files.map(async (name) => {
            try {
                const stat = await fs.stat(path.join(MINICLAW_DIR, name));
                const daysSince = Math.round((now - stat.mtimeMs) / (1000 * 60 * 60 * 24));
                return { name, days: daysSince };
            } catch { return null; }
        }));

        for (const r of results) {
            if (!r) continue;
            if (r.days > 30) warnings.push(`🔴 ${r.name}: ${r.days}d stale`);
            else if (r.days > 14) warnings.push(`⚠️ ${r.name}: ${r.days}d old`);
        }

        return warnings;
    }

    // === Morning Briefing Generator ===

    async generateBriefing(): Promise<string> {
        await this.loadState();
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];

        let briefing = `## 🌅 Daily Briefing — ${today}\n\n`;

        // Yesterday's activity
        let yesterdayLog = "";
        try {
            yesterdayLog = await fs.readFile(path.join(MEMORY_DIR, `${yesterday}.md`), "utf-8");
        } catch { /* no log */ }

        if (yesterdayLog) {
            const entries = yesterdayLog.split('\n').filter(l => l.startsWith('- ['));
            briefing += `### 📋 Yesterday (${entries.length} entries)\n`;
            // Show last 5 entries
            const recent = entries.slice(-5);
            for (const entry of recent) {
                briefing += `${entry}\n`;
            }
            briefing += `\n`;
        }

        // Open questions from yesterday
        if (yesterdayLog) {
            const questions = yesterdayLog.split('\n')
                .filter(l => /\?|TODO|todo|待|需要/.test(l))
                .slice(-3);
            if (questions.length > 0) {
                briefing += `### ❓ Unresolved\n`;
                for (const q of questions) {
                    briefing += `${q}\n`;
                }
                briefing += `\n`;
            }
        }

        // Usage analytics
        const analytics = this.state.analytics;
        const topTools = Object.entries(analytics.toolCalls)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3);
        if (topTools.length > 0) {
            briefing += `### 📊 Usage Stats\n`;
            briefing += `- Boot count: ${analytics.bootCount} | Avg boot: ${analytics.bootCount > 0 ? Math.round(analytics.totalBootMs / analytics.bootCount) : 0}ms\n`;
            briefing += `- Top tools: ${topTools.map(([name, count]) => `${name}(${count})`).join(', ')}\n\n`;
        }

        // Skills inventory
        const skills = await this.skillCache.getAll();
        const unusedSkills = Array.from(skills.keys())
            .filter(name => !(analytics.skillUsage[name]));
        if (unusedSkills.length > 0) {
            briefing += `### 💡 Installed but unused skills: ${unusedSkills.join(', ')}\n\n`;
        }

        // Entity summary
        const entities = await this.entityStore.list();
        if (entities.length > 0) {
            const recentEntities = entities
                .sort((a, b) => b.lastMentioned.localeCompare(a.lastMentioned))
                .slice(0, 5);
            briefing += `### 🕸️ Top Entities\n`;
            for (const e of recentEntities) {
                briefing += `- **${e.name}** (${e.type}, ${e.mentionCount}x) — last: ${e.lastMentioned}\n`;
            }
        }

        // File health
        const warnings = await this.checkFileHealth();
        if (warnings.length > 0) {
            briefing += `\n### 🏥 Health\n`;
            for (const w of warnings) briefing += `- ${w}\n`;
        }

        return briefing;
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
        const sorted = [...sections].sort((a, b) => b.priority - a.priority);
        const maxChars = budgetTokens * CHARS_PER_TOKEN;
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
                if (remaining > 200) {
                    const truncated = section.content.substring(0, remaining - 50) +
                        `\n\n... [${section.name}: truncated, ${sectionChars - remaining} chars omitted]\n`;
                    output += truncated;
                    totalChars += truncated.length;
                    truncatedSections.push(section.name);
                } else {
                    truncatedSections.push(section.name);
                }
            }
        }

        const totalTokens = Math.round(totalChars / CHARS_PER_TOKEN);
        return {
            output, totalChars, totalTokens, budgetTokens,
            utilizationPct: Math.round((totalTokens / budgetTokens) * 100),
            truncatedSections,
        };
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
        return {
            os: `${os.type()} ${os.release()} (${os.arch()})`,
            node: process.version,
            time: new Date().toLocaleString("en-US", { timeZoneName: "short" }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            cwd: process.cwd(),
            agentId: "main"
        };
    }

    private async scanMemory() {
        const today = new Date().toISOString().split('T')[0];
        const todayFile = `memory/${today}.md`;
        const [todayContent, archivedCount] = await Promise.all([
            fs.readFile(path.join(MINICLAW_DIR, todayFile), "utf-8").catch(() => ""),
            fs.readdir(path.join(MEMORY_DIR, "archived"))
                .then(files => files.filter(f => f.endsWith('.md')).length)
                .catch(() => 0),
        ]);
        // Derive entry count from content already read (no double-read)
        const entryCount = todayContent ? (todayContent.match(/^- \[/gm) || []).length : 0;

        // Oldest entry age
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

    private async loadTemplates() {
        const names = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md", "SUBAGENT.md"];
        // Core files that should never be empty — auto-recover from templates if corrupted
        const CORE_RECOVER = new Set(["AGENTS.md", "SOUL.md", "IDENTITY.md", "MEMORY.md"]);
        const results = await Promise.all(names.map(async (name) => {
            try {
                const filePath = path.join(MINICLAW_DIR, name);
                const content = await fs.readFile(filePath, "utf-8");
                // Corruption check: if core file is suspiciously small, recover
                if (CORE_RECOVER.has(name) && content.trim().length < 10) {
                    this.bootErrors.push(`🔧 ${name}: corrupted (${content.length}B), auto-recovering`);
                    try {
                        const tplDir = path.join(path.resolve(MINICLAW_DIR, ".."), ".miniclaw-templates");
                        // Fallback: check common template locations
                        for (const dir of [tplDir, path.join(MINICLAW_DIR, "..", "MiniClaw", "templates")]) {
                            try {
                                const tpl = await fs.readFile(path.join(dir, name), "utf-8");
                                await fs.writeFile(filePath, tpl, "utf-8");
                                return tpl;
                            } catch { continue; }
                        }
                    } catch { /* recovery failed, use what we have */ }
                }
                return content;
            } catch (e) {
                if (name !== "BOOTSTRAP.md" && name !== "SUBAGENT.md" && name !== "HEARTBEAT.md") {
                    this.bootErrors.push(`${name}: ${(e as Error).message?.split('\n')[0] || 'read failed'}`);
                }
                return "";
            }
        }));
        return {
            agents: results[0], soul: results[1], identity: results[2],
            user: results[3], tools: results[4], memory: results[5],
            heartbeat: results[6], bootstrap: results[7], subagent: results[8],
        };
    }

    private formatFile(name: string, content: string): string {
        if (!content) return "";
        return `\n## ${name}\n${content}\n---`;
    }

    private async ensureDirs() {
        await Promise.all([
            fs.mkdir(MINICLAW_DIR, { recursive: true }).catch(() => { }),
            fs.mkdir(SKILLS_DIR, { recursive: true }).catch(() => { }),
            fs.mkdir(MEMORY_DIR, { recursive: true }).catch(() => { }),
        ]);
    }

    // === Public API: Skill Discovery ===

    async discoverSkillPrompts(): Promise<SkillPromptDeclaration[]> {
        const allPrompts: SkillPromptDeclaration[] = [];
        const skills = await this.skillCache.getAll();
        for (const [, skill] of skills) {
            allPrompts.push(...this.parseSkillPromptEntries(skill.frontmatter, skill.name));
        }
        return allPrompts;
    }

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
        const logTokens = Math.round(dailyLogBytes / CHARS_PER_TOKEN);
        const budgetPressure = logTokens / DEFAULT_TOKEN_BUDGET;
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

    // === Private Parsers ===

    private parseSkillPromptEntries(frontmatter: Record<string, unknown>, skillName: string): SkillPromptDeclaration[] {
        const prompts: SkillPromptDeclaration[] = [];
        const raw = getSkillMeta(frontmatter, 'prompts');
        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === 'string') {
                    const parts = item.split(':');
                    const promptName = parts[0]?.trim() || '';
                    const description = parts.slice(1).join(':').trim() || `Skill: ${skillName}`;
                    if (promptName) {
                        prompts.push({ skillName, promptName: `skill:${skillName}:${promptName}`, description });
                    }
                }
            }
        }
        if (prompts.length === 0 && frontmatter['name']) {
            const desc = (frontmatter['description'] as string) || `Skill: ${skillName}`;
            prompts.push({ skillName, promptName: `skill:${skillName}`, description: desc });
        }
        return prompts;
    }

    private parseSkillToolEntries(frontmatter: Record<string, unknown>, skillName: string): SkillToolDeclaration[] {
        const tools: SkillToolDeclaration[] = [];
        const raw = getSkillMeta(frontmatter, 'tools');
        const execVal = getSkillMeta(frontmatter, 'exec');
        const execScript = typeof execVal === 'string' ? execVal : undefined;

        if (Array.isArray(raw)) {
            for (const item of raw) {
                if (typeof item === 'string') {
                    const parts = item.split(':');
                    const toolName = parts[0]?.trim() || '';
                    const description = parts.slice(1).join(':').trim() || `Skill tool: ${skillName}`;
                    if (toolName) {
                        tools.push({ skillName, toolName: `skill_${skillName}_${toolName}`, description, exec: execScript });
                    }
                }
            }
        } else if (execScript) {
            // If there's an 'exec' script but no explicit tools list, register a default runner
            tools.push({
                skillName,
                toolName: `skill_${skillName}_run`,
                description: `Execute skill script: ${execScript}`,
                exec: execScript
            });
        }
        return tools;
    }
}
