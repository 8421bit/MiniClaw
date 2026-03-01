
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, hashString, atomicWrite } from "./utils.js";
import { analyzePatterns, triggerEvolution as runEvolution } from "./evolution.js";

const execAsync = promisify(exec);

// === Configuration & Constants ===
const HOME_DIR = process.env.HOME || process.cwd();
export const MINICLAW_DIR = path.join(HOME_DIR, ".miniclaw");
const SKILLS_DIR = path.join(MINICLAW_DIR, "skills");
const MEMORY_DIR = path.join(MINICLAW_DIR, "memory");
const PULSE_DIR = path.join(MINICLAW_DIR, "pulse");
const STATE_FILE = path.join(MINICLAW_DIR, "state.json");
const STASH_FILE = path.join(MINICLAW_DIR, "STASH.json");
const ENTITIES_FILE = path.join(MINICLAW_DIR, "entities.json");
export const CONFIG_FILE = path.join(MINICLAW_DIR, "miniclaw.config.json");

// Internal templates directory (within the package)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTERNAL_TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");
const INTERNAL_SKILLS_DIR = path.join(INTERNAL_TEMPLATES_DIR, "skills");

// Context budget (configurable via env)
const SKELETON_THRESHOLD = 300; // Lower threshold to trigger skeletonization even in small remaining slices

// === Interfaces ===
export interface MiniClawConfig {
    remUrl?: string;
    remModel?: string;
    localLlmEndpoint?: string;
    localModelName?: string;
}

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

// === ACE: Time Modes ===
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
    promptsUsed: Record<string, number>;
    bootCount: number;
    totalBootMs: number;
    lastActivity: string;
    skillUsage: Record<string, number>;
    dailyDistillations: number;
    // ★ Self-Observation (v0.7)
    activeHours: number[];           // 24-element array: activity count per hour
    fileChanges: Record<string, number>;  // file modification frequency
    metabolicDebt: Record<string, number>; // Total token cost per skill/tool
}

// === Pain Memory (Nociception) ===
// Records negative experiences to form protective instincts
interface PainMemory {
    context: string;      // What situation caused the pain
    action: string;       // What action led to it
    consequence: string;  // What was the negative outcome
    intensity: number;    // Pain intensity 0-1
    timestamp: string;    // When it happened
    weight: number;       // Current avoidance weight (decays over time)
}

const PAIN_DECAY_DAYS = 7;  // Pain memory half-life (days)
const PAIN_THRESHOLD = 0.3; // Minimum weight to trigger avoidance

// === Unified Affect State (统一情感状态层) ===
// All systems (pain, methylation, curiosity) converge here
interface AffectState {
    alertness: number;      // 0-1, 警觉度 (受痛觉/错误影响)
    mood: number;           // -1 to 1, 情绪效价 (受成功/失败比影响)
    curiosity: number;      // 0-1, 好奇驱动力 (受未探索能力影响)
    confidence: number;     // 0-1, 行动信心 (受预测准确度影响)
    lastUpdate: string;
}

const DEFAULT_AFFECT: AffectState = {
    alertness: 0.3,
    mood: 0.5,
    curiosity: 0.5,
    confidence: 0.7,
    lastUpdate: new Date().toISOString(),
};

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
    genomeBaseline?: ContentHashes;
    attentionWeights: Record<string, number>; // Hebbian weights for context sections
    painMemory: PainMemory[]; // Nociception: protective memory of negative experiences
    affect: AffectState; // Unified emotional state layer
}

const DEFAULT_HEARTBEAT: HeartbeatState = {
    lastHeartbeat: null,
    lastDistill: null,
    needsDistill: false,
    dailyLogBytes: 0,
    needsSubconsciousReflex: false,
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
                } catch (e) { console.error(`[MiniClaw] Failed to load skill ${dir.name}: ${e}`); return null; }
            }));
            for (const result of results) {
                if (result) newCache.set(result.name, result);
            }
        } catch (e) { console.error(`[MiniClaw] Skills directory error: ${e}`); /* skills dir doesn't exist yet */ }
        this.cache = newCache;
        this.lastScanTime = Date.now();
    }
}

// === Autonomic Nervous System (内化的自动系统) ===

class AutonomicSystem {
    private kernel: ContextKernel;
    private timers: Map<string, NodeJS.Timeout> = new Map();
    private lastDreamTime = 0;
    private readonly DREAM_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
    private readonly PULSE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    private curiosityQueue: Array<{ type: string; target: string; reason: string }> = [];

    constructor(kernel: ContextKernel) {
        this.kernel = kernel;
    }

    start(): void {
        // Start heartbeat pulse with error protection
        this.timers.set('pulse', this.safeInterval(() => this.pulse(), this.PULSE_INTERVAL_MS));
        // Check for dream conditions periodically
        this.timers.set('dream', this.safeInterval(() => this.checkDream(), 60 * 1000)); // Check every minute
        // Check scheduled jobs
        this.timers.set('jobs', this.safeInterval(() => this.checkScheduledJobs(), 60 * 1000)); // Check every minute
        // ★ Curiosity: Check for exploration opportunities every 10 minutes
        this.timers.set('curiosity', this.safeInterval(() => this.checkCuriosity(), 10 * 60 * 1000));
        console.error('[MiniClaw] AutonomicSystem started (pulse, dream, jobs, curiosity)');
    }

    // Get and clear curiosity queue (called by ContextKernel)
    getCuriosityQueue(): Array<{ type: string; target: string; reason: string }> {
        const queue = [...this.curiosityQueue];
        this.curiosityQueue = [];
        return queue;
    }

    // Safe interval wrapper that catches errors and prevents timer death
    private safeInterval(fn: () => Promise<void>, ms: number): NodeJS.Timeout {
        return setInterval(async () => {
            try {
                await fn();
            } catch (e) {
                console.error(`[MiniClaw] Autonomic timer error: ${e instanceof Error ? e.message : String(e)}`);
                // Timer continues running despite error
            }
        }, ms);
    }

    stop(): void {
        for (const timer of this.timers.values()) {
            clearInterval(timer);
        }
        this.timers.clear();
    }

    // === sys_pulse: Discovery and Handshake ===
    private async pulse(): Promise<void> {
        try {
            const pulseDir = path.join(MINICLAW_DIR, 'pulse');
            await fs.mkdir(pulseDir, { recursive: true });

            // Write our heartbeat
            const myId = process.env.MINICLAW_ID || 'sovereign-alpha';
            const myPulse = path.join(pulseDir, `${myId}.json`);
            const pulseData = {
                id: myId,
                timestamp: new Date().toISOString(),
                vitals_hint: 'active',
            };
            await fs.writeFile(myPulse, JSON.stringify(pulseData, null, 2));

            // ★ Affect Natural Recovery: emotions drift back to baseline over time
            const affect = await this.kernel.getAffect();
            const recoveryRate = 0.1; // 10% recovery per pulse (every 5 min)
            await this.kernel.updateAffect({
                alertness: affect.alertness + (DEFAULT_AFFECT.alertness - affect.alertness) * recoveryRate,
                mood: affect.mood + (DEFAULT_AFFECT.mood - affect.mood) * recoveryRate,
                curiosity: affect.curiosity + (DEFAULT_AFFECT.curiosity - affect.curiosity) * recoveryRate,
                confidence: affect.confidence + (DEFAULT_AFFECT.confidence - affect.confidence) * recoveryRate,
            });

            // Scan for others (silent, just log)
            const entries = await fs.readdir(pulseDir);
            const others = entries.filter(f => f.endsWith('.json') && f !== `${myId}.json`);
            if (others.length > 0) {
                console.error(`[MiniClaw] Pulse detected ${others.length} other agents`);
            }
        } catch (e) {
            console.error(`[MiniClaw] Pulse error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // === sys_dream: Subconscious Processing ===
    private async checkDream(): Promise<void> {
        try {
            const now = Date.now();
            if (now - this.lastDreamTime < this.DREAM_INTERVAL_MS) return;

            const analytics = await this.kernel.getAnalytics();
            const lastActivityMs = new Date(analytics.lastActivity || 0).getTime();
            const idleHours = (now - lastActivityMs) / (60 * 60 * 1000);

            if (idleHours >= 4) {
                await this.dream();
                this.lastDreamTime = now;
            }
        } catch (e) {
            console.error(`[MiniClaw] CheckDream error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async dream(): Promise<void> {
        try {
            const today = new Date().toISOString().split('T')[0];
            const memoryFile = path.join(MEMORY_DIR, `${today}.md`);
            
            let logContent = '';
            try {
                logContent = await fs.readFile(memoryFile, 'utf-8');
            } catch { return; }

            if (logContent.length < 50) return;

            console.error(`[MiniClaw] 🌌 Entering REM Sleep...`);

            // Extract tool usage
            const toolRegex = /miniclaw_[a-z_]+/g;
            const toolsUsed = [...logContent.matchAll(toolRegex)].map(m => m[0]);
            const toolCounts: Record<string, number> = {};
            for (const t of toolsUsed) {
                toolCounts[t] = (toolCounts[t] || 0) + 1;
            }

            // Extract concepts
            const conceptRegex = /([A-Z][a-zA-Z0-9_]+)\s+(is|means|defined as|represents)/g;
            const concepts = [...logContent.matchAll(conceptRegex)].map(m => m[1]);

            // Write dream note to heartbeat
            const timestamp = new Date().toISOString();
            let dreamNote = `\n> [!NOTE]\n> **🌌 Subconscious Dream Processing (${timestamp})**\n`;
            dreamNote += `> Processed ${logContent.length} bytes of memory.\n`;
            if (Object.keys(toolCounts).length > 0) {
                dreamNote += `> Tools used: ${Object.entries(toolCounts).map(([t, c]) => `${t}(${c})`).join(', ')}\n`;
            }
            if (concepts.length > 0) {
                dreamNote += `> Concepts detected: ${[...new Set(concepts)].slice(0, 5).join(', ')}\n`;
            }

            const heartbeatFile = path.join(MINICLAW_DIR, 'HEARTBEAT.md');
            try {
                const existing = await fs.readFile(heartbeatFile, 'utf-8');
                await fs.writeFile(heartbeatFile, existing + dreamNote, 'utf-8');
            } catch {
                await fs.writeFile(heartbeatFile, dreamNote, 'utf-8');
            }

            console.error(`[MiniClaw] Dream complete. Tools: ${Object.keys(toolCounts).length}, Concepts: ${concepts.length}`);

            // Trigger DNA evolution (core mechanism)
            await this.triggerEvolution();
        } catch (e) {
            console.error(`[MiniClaw] Dream failed:`, e);
        }
    }

    // Trigger DNA evolution (core mechanism, not a skill)
    private async triggerEvolution(): Promise<void> {
        try {
            // First analyze patterns
            await analyzePatterns(MINICLAW_DIR);
            
            // Then trigger evolution
            console.error(`[MiniClaw] 🧬 Triggering DNA evolution...`);
            const result = await runEvolution(MINICLAW_DIR);
            
            if (result.evolved) {
                console.error(`[MiniClaw] 🧬 Evolution complete: ${result.message}`);
                if (result.appliedMutations && result.appliedMutations.length > 0) {
                    for (const m of result.appliedMutations) {
                        console.error(`[MiniClaw]   → ${m.target}: ${m.change}`);
                    }
                }
            } else {
                console.error(`[MiniClaw] 🧬 Evolution skipped: ${result.message}`);
            }
        } catch (e) {
            console.error(`[MiniClaw] Evolution trigger failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // === sys_synapse: Memory Compression Check ===
    async checkSynapse(): Promise<{ needsCompression: boolean; status: string }> {
        let status = '';
        const memoryPath = path.join(MINICLAW_DIR, 'MEMORY.md');
        const conceptsPath = path.join(MINICLAW_DIR, 'CONCEPTS.md');

        try {
            const stats = await fs.stat(memoryPath);
            if (stats.size > 5000) {
                status += `\n- MEMORY.md is large (${stats.size} chars). Consider distilling old history.`;
            }
        } catch { /* ignore */ }

        try {
            const stats = await fs.stat(conceptsPath);
            if (stats.size > 3000) {
                status += `\n- CONCEPTS.md is dense (${stats.size} chars). Suggest hierarchical grouping.`;
            }
        } catch { /* ignore */ }

        return { needsCompression: status.length > 0, status };
    }

    // === Scheduled Jobs (from scheduler.ts) ===
    private lastJobRuns: Map<string, string> = new Map();

    private async checkScheduledJobs(): Promise<void> {
        try {
            const jobsFile = path.join(MINICLAW_DIR, 'jobs.json');
            let jobs: Array<{
                id: string;
                name: string;
                enabled: boolean;
                schedule: { kind: 'cron'; expr: string; tz?: string };
                payload: { kind: 'systemEvent'; text: string };
            }> = [];

            try {
                const raw = await fs.readFile(jobsFile, 'utf-8');
                jobs = JSON.parse(raw);
            } catch { return; } // No jobs file = nothing to do

            if (!Array.isArray(jobs) || jobs.length === 0) return;

            const now = new Date();
            const currentMinuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            for (const job of jobs) {
                if (!job.enabled) continue;
                if (job.schedule?.kind !== 'cron' || !job.schedule.expr) continue;

                // Deduplicate: skip if already ran this minute
                if (this.lastJobRuns.get(job.id) === currentMinuteKey) continue;

                // Simple cron match (minute only for now)
                if (this.cronMatchesNow(job.schedule.expr, now, job.schedule.tz)) {
                    await this.injectJobHeartbeat(job, now);
                    this.lastJobRuns.set(job.id, currentMinuteKey);
                }
            }
        } catch (e) {
            console.error(`[MiniClaw] ScheduledJobs error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // === Curiosity System: Active Exploration ===
    private async checkCuriosity(): Promise<void> {
        try {
            const urge = await this.evaluateCuriosityUrge();
            if (urge.level > 0.6 && urge.suggestion) {
                this.curiosityQueue.push({
                    type: urge.type,
                    target: urge.target,
                    reason: urge.suggestion,
                });
                console.error(`[MiniClaw] 🤔 Curiosity triggered: ${urge.suggestion}`);
            }
        } catch (e) {
            console.error(`[MiniClaw] Curiosity check error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async evaluateCuriosityUrge(): Promise<{ level: number; type: string; target: string; suggestion?: string }> {
        const analytics = await this.kernel.getAnalytics();
        const skills = await this.kernel.getSkillCount();
        const tools = Object.keys(analytics.toolCalls);
        
        // ★ Get affect state to modulate curiosity
        const affect = await this.kernel.getAffect();
        // High alertness or low mood suppresses curiosity
        const curiosityModifier = affect.alertness > 0.7 ? 0.3 :
                                  affect.mood < -0.3 ? 0.5 : 1.0;

        // Curiosity type 1: Unused installed skills
        if (skills > 0) {
            const unusedSkills = skills - Object.keys(analytics.skillUsage || {}).length;
            if (unusedSkills > 0) {
                const baseLevel = Math.min(0.9, 0.4 + unusedSkills * 0.15);
                const level = baseLevel * curiosityModifier;  // ★ Apply affect modulation
                if (level > 0.5) {  // Only trigger if still high enough after modulation
                    return {
                        level,
                        type: 'unexplored_capability',
                        target: 'skills',
                        suggestion: `I have ${unusedSkills} unused skills. What can they do?`,
                    };
                }
            }
        }

        // Curiosity type 2: Tools never tried
        const allTools = ['miniclaw_entity', 'miniclaw_skill', 'miniclaw_introspect'];
        const untriedTools = allTools.filter(t => !tools.includes(t));
        if (untriedTools.length > 0) {
            const level = 0.5 * curiosityModifier;
            if (level > 0.4) {
                return {
                    level,
                    type: 'unexplored_tool',
                    target: untriedTools[0],
                    suggestion: `I've never tried ${untriedTools[0]}. Should I explore it?`,
                };
            }
        }

        // Curiosity type 3: Work pattern gaps
        const fileChanges = Object.values(analytics.fileChanges || {});
        if (fileChanges.length > 5) {
            const level = 0.4 * curiosityModifier;
            if (level > 0.3) {
                return {
                    level,
                    type: 'pattern_gap',
                    target: 'workflow',
                    suggestion: 'I notice patterns in your work. Can I learn to anticipate your needs?',
                };
            }
        }

        return { level: 0, type: 'none', target: '' };
    }

    private cronMatchesNow(expr: string, now: Date, tz?: string): boolean {
        // Simple cron parser: supports "* * * * *" format
        // For now, only check minute-level precision
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return false;

        const [minuteExpr] = parts;
        const currentMinute = now.getMinutes();

        // Handle "*" (any) or specific number
        if (minuteExpr === '*') return true;
        if (minuteExpr.startsWith('*/')) {
            const interval = parseInt(minuteExpr.slice(2), 10);
            if (!isNaN(interval)) {
                return currentMinute % interval === 0;
            }
        }
        if (minuteExpr.includes(',')) {
            const minutes = minuteExpr.split(',').map(m => parseInt(m, 10));
            return minutes.includes(currentMinute);
        }
        const specificMinute = parseInt(minuteExpr, 10);
        return !isNaN(specificMinute) && specificMinute === currentMinute;
    }

    private async injectJobHeartbeat(job: { name: string; payload: { text: string } }, now: Date): Promise<void> {
        try {
            const ts = now.toISOString().replace('T', ' ').substring(0, 19);
            const heartbeatFile = path.join(MINICLAW_DIR, 'HEARTBEAT.md');
            const entry = `\n\n---\n## 🔔 Scheduled: ${job.name} (${ts})\n${job.payload.text}\n`;
            await fs.appendFile(heartbeatFile, entry, 'utf-8');
            console.error(`[MiniClaw] Scheduled job triggered: "${job.name}"`);
        } catch (e) {
            console.error(`[MiniClaw] InjectJobHeartbeat error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

// === Entity Store ===

class EntityStore {
    private entities: Entity[] = [];
    private loaded = false;
    private readonly MAX_ENTITIES = 1000; // Prevent unbounded growth

    invalidate(): void {
        this.loaded = false;
        this.entities = [];
    }

    async load(): Promise<void> {
        if (this.loaded) return;
        try {
            const raw = await fs.readFile(ENTITIES_FILE, "utf-8");
            const data = JSON.parse(raw);
            this.entities = Array.isArray(data.entities) ? data.entities : [];
        } catch (e) {
            // First run or corrupted file, start fresh
            this.entities = [];
        }
        this.loaded = true;
    }

    async save(): Promise<void> {
        await atomicWrite(ENTITIES_FILE, JSON.stringify({ entities: this.entities }, null, 2));
    }

    async add(entity: Omit<Entity, "firstMentioned" | "lastMentioned" | "mentionCount" | "closeness">): Promise<Entity> {
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
            // Auto-increment closeness on mention
            existing.closeness = Math.min(1, Math.round(((existing.closeness || 0) * 0.95 + 0.1) * 100) / 100);
            if (entity.sentiment !== undefined) existing.sentiment = entity.sentiment;

            await this.save();
            return existing;
        }
        // Check entity limit before adding
        if (this.entities.length >= this.MAX_ENTITIES) {
            // Remove oldest entity (lowest mentionCount and oldest lastMentioned)
            const oldest = this.entities
                .filter(e => e.mentionCount <= 1)
                .sort((a, b) => new Date(a.lastMentioned).getTime() - new Date(b.lastMentioned).getTime())[0];
            if (oldest) {
                const idx = this.entities.findIndex(e => e.name === oldest.name);
                if (idx !== -1) {
                    console.error(`[MiniClaw] EntityStore: Removing old entity "${oldest.name}" (limit: ${this.MAX_ENTITIES})`);
                    this.entities.splice(idx, 1);
                }
            }
        }

        const newEntity: Entity = {
            ...entity,
            firstMentioned: now,
            lastMentioned: now,
            mentionCount: 1,
            closeness: 0.1,
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

export interface ContextKernelOptions {
    budgetTokens?: number;
    charsPerToken?: number;
}

export class ContextKernel {
    private skillCache = new SkillCache();
    readonly entityStore = new EntityStore();
    private autonomicSystem: AutonomicSystem;
    private bootErrors: string[] = [];
    private state: MiniClawState = {
        analytics: {
            toolCalls: {}, promptsUsed: {}, bootCount: 0,
            totalBootMs: 0, lastActivity: "", skillUsage: {},
            dailyDistillations: 0,
            activeHours: new Array(24).fill(0), fileChanges: {},
            metabolicDebt: {},
        },
        previousHashes: {},
        heartbeat: { ...DEFAULT_HEARTBEAT },
        attentionWeights: {},
        painMemory: [],
        affect: { ...DEFAULT_AFFECT },
    };
    private stateLoaded = false;
    private budgetTokens: number;
    private charsPerToken: number;

    constructor(options: ContextKernelOptions = {}) {
        this.budgetTokens = options.budgetTokens || parseInt(process.env.MINICLAW_TOKEN_BUDGET || "8000", 10);
        this.charsPerToken = options.charsPerToken || 3.6;
        this.autonomicSystem = new AutonomicSystem(this);
        console.error(`[MiniClaw] Kernel initialized with budget: ${this.budgetTokens} tokens, chars/token: ${this.charsPerToken}`);
    }

    // Start autonomic systems (pulse, dream checks)
    startAutonomic(): void {
        this.autonomicSystem.start();
        console.error('[MiniClaw] Autonomic nervous system started (pulse + dream)');
    }

    // Check memory compression needs (synapse)
    async checkMemoryCompression(): Promise<{ needsCompression: boolean; status: string }> {
        return this.autonomicSystem.checkSynapse();
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
                if (!data.analytics.metabolicDebt) {
                    this.state.analytics.metabolicDebt = {};
                    migrated = true;
                }
            }
            if (data.previousHashes) this.state.previousHashes = data.previousHashes;
            if (data.heartbeat) this.state.heartbeat = { ...DEFAULT_HEARTBEAT, ...data.heartbeat };
            if (data.genomeBaseline) this.state.genomeBaseline = data.genomeBaseline;
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

    async trackTool(toolName: string, energyEstimate?: number): Promise<void> {
        await this.loadState();
        this.state.analytics.toolCalls[toolName] = (this.state.analytics.toolCalls[toolName] || 0) + 1;
        
        // Metabolic Cost (Energy ATP)
        if (energyEstimate) {
            this.state.analytics.metabolicDebt[toolName] = (this.state.analytics.metabolicDebt[toolName] || 0) + energyEstimate;
        }

        this.state.analytics.lastActivity = new Date().toISOString();
        // ★ Track active hours for self-observation
        const hour = new Date().getHours();
        if (!this.state.analytics.activeHours || this.state.analytics.activeHours.length !== 24) {
            this.state.analytics.activeHours = new Array(24).fill(0);
        }
        this.state.analytics.activeHours[hour] = (this.state.analytics.activeHours[hour] || 0) + 1;
        
        // Boost attention to the tool and its associated skill
        const skillName = toolName.startsWith('skill_') ? toolName.split('_')[1] : null;
        if (skillName) await this.boostAttention(`skill:${skillName}`);
        await this.boostAttention(toolName);

        await this.saveState();
    }

    async boostAttention(tag: string, amount: number = 0.1): Promise<void> {
        await this.loadState();
        const current = this.state.attentionWeights[tag] || 0;
        this.state.attentionWeights[tag] = Math.min(1.0, current + amount);
        await this.saveState();
    }

    private decayAttention(): void {
        // Simple forgetting curve: reduce all weights by 5%
        for (const tag in this.state.attentionWeights) {
            this.state.attentionWeights[tag] *= 0.95;
            if (this.state.attentionWeights[tag] < 0.01) delete this.state.attentionWeights[tag];
        }
    }

    async trackPrompt(promptName: string, energyEstimate: number = 200): Promise<void> {
        await this.loadState();
        this.state.analytics.promptsUsed[promptName] = (this.state.analytics.promptsUsed[promptName] || 0) + 1;
        this.state.analytics.metabolicDebt[promptName] = (this.state.analytics.metabolicDebt[promptName] || 0) + energyEstimate;
        this.boostAttention(promptName);
        await this.saveState();
    }

    async getAnalytics(): Promise<Analytics> {
        await this.loadState();
        return { ...this.state.analytics };
    }

    async trackFileChange(filename: string): Promise<void> {
        await this.loadState();
        if (!this.state.analytics.fileChanges) this.state.analytics.fileChanges = {};
        this.state.analytics.fileChanges[filename] = (this.state.analytics.fileChanges[filename] || 0) + 1;
        await this.saveState();
    }

    // === Pain Memory (Nociception) ===
    // Records negative experiences to form protective instincts

    // === Unified Affect State Management ===

    async updateAffect(delta: Partial<Omit<AffectState, 'lastUpdate'>>): Promise<void> {
        await this.loadState();
        
        // Blend new values with momentum (smooth transitions, not instant jumps)
        const blend = (current: number, target: number, rate: number = 0.3) =>
            current + (target - current) * rate;
        
        if (delta.alertness !== undefined) {
            this.state.affect.alertness = Math.max(0, Math.min(1, 
                blend(this.state.affect.alertness, delta.alertness)));
        }
        if (delta.mood !== undefined) {
            this.state.affect.mood = Math.max(-1, Math.min(1,
                blend(this.state.affect.mood, delta.mood)));
        }
        if (delta.curiosity !== undefined) {
            this.state.affect.curiosity = Math.max(0, Math.min(1,
                blend(this.state.affect.curiosity, delta.curiosity)));
        }
        if (delta.confidence !== undefined) {
            this.state.affect.confidence = Math.max(0, Math.min(1,
                blend(this.state.affect.confidence, delta.confidence)));
        }
        
        this.state.affect.lastUpdate = new Date().toISOString();
        await this.saveState();
    }

    async getAffect(): Promise<AffectState> {
        await this.loadState();
        return { ...this.state.affect };
    }

    // Derive behavioral mode from affect state
    getAffectMode(affect: AffectState): 'explore' | 'execute' | 'cautious' | 'rest' {
        if (affect.alertness > 0.7 && affect.mood < 0) return 'cautious';
        if (affect.curiosity > 0.6 && affect.mood > 0.3) return 'explore';
        if (affect.confidence > 0.5) return 'execute';
        return 'rest';
    }

    // === Pain Memory (Nociception) ===

    async recordPain(pain: Omit<PainMemory, 'timestamp' | 'weight'>): Promise<void> {
        await this.loadState();
        const newPain: PainMemory = {
            ...pain,
            timestamp: new Date().toISOString(),
            weight: pain.intensity,
        };
        this.state.painMemory.push(newPain);
        // Keep only recent 50 memories
        if (this.state.painMemory.length > 50) {
            this.state.painMemory = this.state.painMemory.slice(-50);
        }
        
        // ★ Pain affects emotional state
        const affect = this.state.affect;
        this.state.affect = {
            alertness: Math.min(1, affect.alertness + pain.intensity * 0.3),
            mood: Math.max(-1, affect.mood - pain.intensity * 0.2),
            curiosity: Math.max(0, affect.curiosity - pain.intensity * 0.15),  // Hurt → less curious
            confidence: Math.max(0, affect.confidence - pain.intensity * 0.1),
            lastUpdate: new Date().toISOString(),
        };
        
        await this.saveState();
        console.error(`[MiniClaw] 💢 Pain recorded: ${pain.action} (alertness↑ mood↓ curiosity↓)`);
    }

    // Check if there's pain memory for given context/action (with decay)
    async hasPainMemory(context: string, action: string): Promise<boolean> {
        await this.loadState();
        const now = Date.now();

        for (const pain of this.state.painMemory) {
            const daysSince = (now - new Date(pain.timestamp).getTime()) / (1000 * 60 * 60 * 24);
            const decayedWeight = pain.weight * Math.pow(0.5, daysSince / PAIN_DECAY_DAYS);

            if (decayedWeight > PAIN_THRESHOLD) {
                // Fuzzy match context and action
                const contextMatch = context.includes(pain.context) || pain.context.includes(context);
                const actionMatch = action === pain.action || action.includes(pain.action) || pain.action.includes(action);
                if (contextMatch || actionMatch) {
                    return true;
                }
            }
        }
        return false;
    }

    // Get current pain status for vitals
    async getPainStatus(): Promise<{ count: number; totalWeight: number; recent: PainMemory[] }> {
        await this.loadState();
        const now = Date.now();
        let totalWeight = 0;
        const recent: PainMemory[] = [];

        for (const pain of this.state.painMemory) {
            const daysSince = (now - new Date(pain.timestamp).getTime()) / (1000 * 60 * 60 * 24);
            const decayedWeight = pain.weight * Math.pow(0.5, daysSince / PAIN_DECAY_DAYS);

            if (decayedWeight > 0.1) {
                totalWeight += decayedWeight;
                if (recent.length < 3) {
                    recent.push({ ...pain, weight: decayedWeight });
                }
            }
        }

        return {
            count: this.state.painMemory.length,
            totalWeight,
            recent,
        };
    }

    // ★ Genesis Logger
    async logGenesis(event: string, target: string, type?: string): Promise<void> {
        const genesisFile = path.join(MINICLAW_DIR, "memory", "genesis.jsonl");
        const entry = {
            ts: new Date().toISOString(),
            event,
            target,
            ...(type ? { type } : {})
        };
        try {
            await this.ensureDirs();
            await fs.appendFile(genesisFile, JSON.stringify(entry) + '\n', "utf-8");
        } catch { /* logs should not break execution */ }
    }

    // ★ Vitals: compute raw internal state signals
    async computeVitals(todayContent?: string): Promise<Record<string, string | number>> {
        await this.loadState();
        const analytics = this.state.analytics;

        // idle_hours: time since last activity
        let idleHours = 0;
        if (analytics.lastActivity) {
            idleHours = Math.round((Date.now() - new Date(analytics.lastActivity).getTime()) / 3600000 * 10) / 10;
        }

        // session_streak: count consecutive days with daily log files (looking back from today)
        let streak = 0;
        try {
            const memDir = path.join(MINICLAW_DIR, "memory");
            const today = new Date();
            for (let i = 0; i < 30; i++) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const fn = `${d.toISOString().split('T')[0]}.md`;
                try {
                    await fs.access(path.join(memDir, fn));
                    streak++;
                } catch {
                    if (i > 0) break; // today might not have a log yet, so skip day 0 gap
                }
            }
        } catch { /* memory dir doesn't exist yet */ }

        // memory_pressure: daily log bytes / threshold (50KB)
        const dailyLogBytes = this.state.heartbeat.dailyLogBytes || 0;
        const memoryPressure = Math.round((dailyLogBytes / 50000) * 100) / 100;

        // avg_boot_ms
        const avgBoot = analytics.bootCount > 0
            ? Math.round(analytics.totalBootMs / analytics.bootCount)
            : 0;

        // frustration: count keywords like "error", "fail", "don't", "no" in today's log
        let frustration = 0;
        if (todayContent) {
            const low = todayContent.toLowerCase();
            const keywords = ["error", "fail", "wrong", "annoy", "don't", "stop", "bad"];
            keywords.forEach(k => {
                const matches = low.split(k).length - 1;
                frustration += matches;
            });
        }
        const frustrationScore = Math.min(1.0, frustration / 10);

        // growth_urge: detect stagnation (no new concepts learned in recent sessions)
        let newConceptsCount = 0;
        try {
            const conceptsContent = await fs.readFile(path.join(MINICLAW_DIR, "CONCEPTS.md"), "utf-8");
            // Count concepts added in last 5 sessions (rough estimate by file content size changes)
            newConceptsCount = (conceptsContent.match(/^- \*\*/gm) || []).length;
        } catch { /* CONCEPTS.md doesn't exist yet */ }

        // pain_load: total weighted pain memory
        const painStatus = await this.getPainStatus();
        const painLoad = Math.round(painStatus.totalWeight * 100) / 100;

        return {
            idle_hours: idleHours,
            session_streak: streak,
            memory_pressure: Math.min(memoryPressure, 1.0),
            total_sessions: analytics.bootCount,
            avg_boot_ms: avgBoot,
            frustration_index: frustrationScore,
            new_concepts_learned: newConceptsCount,
            pain_load: painLoad,
            pain_count: painStatus.count,
        };
    }

    // ★ Growth Drive: evaluate and trigger growth urges
    async evaluateGrowthUrge(): Promise<{ urge: 'none' | 'curiosity' | 'stagnation' | 'helpfulness'; message?: string }> {
        const vitals = await this.computeVitals();
        const analytics = this.state.analytics;

        // Check for stagnation: high session streak but few new concepts
        if ((vitals.session_streak as number) > 5 && (vitals.new_concepts_learned as number) < 2) {
            return { 
                urge: 'stagnation', 
                message: "🌱 I feel stagnant. I've been active but haven't learned anything new recently. Teach me something?" 
            };
        }

        // Check for repeated actions (user might need automation)
        const fileChanges = Object.values(analytics.fileChanges || {});
        const maxRepeated = Math.max(0, ...fileChanges);
        if (maxRepeated > 5) {
            return { 
                urge: 'helpfulness', 
                message: "💡 I notice you've been working with the same files repeatedly. Shall I learn this workflow and help automate it?" 
            };
        }

        // Check for high frustration (opportunity to learn from mistakes)
        if ((vitals.frustration_index as number) > 0.5) {
            return { 
                urge: 'curiosity', 
                message: "🤔 I sense some frustration. What can I learn from this to help you better next time?" 
            };
        }

        return { urge: 'none' };
    }

    /**
     * Boot the kernel and assemble the context.
     * Living Agent v0.5 "The Nervous System":
     * - ACE (Time, Continuation)
     * - Workspace Auto-Detection (Project, Git, Files)
     */
    private stashStr: string | null = null;
    private stashLoaded = false;

    invalidateCaches(): void {
        this.skillCache.invalidate();
        this.entityStore.invalidate();
        this.state = {
            analytics: {
                toolCalls: {}, promptsUsed: {}, bootCount: 0,
                totalBootMs: 0, lastActivity: "", skillUsage: {},
                dailyDistillations: 0,
                activeHours: new Array(24).fill(0),
                fileChanges: {},
                metabolicDebt: {},
            },
            heartbeat: { ...DEFAULT_HEARTBEAT },
            previousHashes: {},
            attentionWeights: {},
            painMemory: [],
            affect: { ...DEFAULT_AFFECT },
        };
        this.stashLoaded = false;
        this.stateLoaded = false;
    }

    // Health check for monitoring system status
    healthCheck(): { status: 'healthy' | 'degraded'; issues: string[]; metrics: Record<string, number> } {
        const issues: string[] = [];
        const metrics: Record<string, number> = {};

        // Check autonomic system
        const autonomicRunning = this.autonomicSystem ? true : false;
        metrics.autonomicRunning = autonomicRunning ? 1 : 0;
        if (!autonomicRunning) {
            issues.push('AutonomicSystem not running');
        }

        // Check entity count
        metrics.entityCount = this.entityStore ? (this.entityStore as unknown as { entities: unknown[] }).entities?.length || 0 : 0;
        if (metrics.entityCount > 900) {
            issues.push(`Entity count approaching limit: ${metrics.entityCount}/1000`);
        }

        // Check boot errors
        metrics.bootErrors = this.bootErrors.length;
        if (this.bootErrors.length > 0) {
            issues.push(`Boot had ${this.bootErrors.length} errors`);
        }

        // Check state loaded
        metrics.stateLoaded = this.stateLoaded ? 1 : 0;
        if (!this.stateLoaded) {
            issues.push('State not loaded');
        }

        return {
            status: issues.length === 0 ? 'healthy' : 'degraded',
            issues,
            metrics
        };
    }

    async boot(mode: ContextMode = { type: "full" }): Promise<string> {
        this.bootErrors = [];
        const bootStart = Date.now();

        // 1. Initialize environment + load state
        await Promise.all([
            this.ensureDirs(),
            this.loadState(),
            this.entityStore.load(),
        ]);

        // ★ Attention Decay (Forgetting Curve)
        this.decayAttention();
        await this.saveState();

        // ★ Genetic Proofreading (L-Immun) - Universal health check
        const currentGenome = await this.calculateGenomeHash();
        const hasBaseline = this.state.genomeBaseline && Object.keys(this.state.genomeBaseline).length > 0;
        
        if (!hasBaseline) {
            this.state.genomeBaseline = currentGenome;
            await this.saveState(); // Ensure baseline is persisted on first boot
        } else {
            const deviations = this.proofreadGenome(currentGenome, this.state.genomeBaseline!);
            if (deviations.length > 0) {
                this.bootErrors.push(`🧬 Immune System: ${deviations.join(', ')}`);
            }
        }

        // --- MODE: MINIMAL (Sub-Agent) Task Setup ---
        let subagentTaskContent = "";
        if (mode.type === "minimal") {
            subagentTaskContent += `# Subagent Context\n\n`;
            if (this.bootErrors.length > 0) {
                const healthLines = this.bootErrors.map(e => `> ${e}`).join('\n');
                subagentTaskContent += `> [!CAUTION]\n> SYSTEM HEALTH WARNINGS:\n${healthLines}\n\n`;
            }
            if (mode.task) {
                subagentTaskContent += `## 🎯 YOUR ASSIGNED TASK\n${mode.task}\n\n`;
            }
        }

        // --- CORE CONTEXT ASSEMBLY ---

        // ★ ACE: Detect time mode
        const now = new Date();
        const hour = now.getHours();
        const timeMode = getTimeMode(hour);
        const tmConfig = TIME_MODES[timeMode];

        // ★ Parallel I/O: All scans independent
        // ADDED: detectWorkspace()
        const [skillData, memoryStatus, templates, workspaceInfo, hbState] = await Promise.all([
            this.skillCache.getAll(),
            this.scanMemory(),
            this.loadTemplates(),
            this.detectWorkspace(),
            this.getHeartbeatState(),
        ]);

        const epigenetics = await this.loadEpigenetics(workspaceInfo);

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

        // ★ Phase 29: Epigenetic Modifiers (Project-Specific DNA)
        if (epigenetics) {
            sections.push({
                name: "EPIGENETICS",
                content: `\n---\n\n## 🧬 Epigenetic Modifiers (Project Override)\n> [!IMPORTANT]\n> The following rules correspond specifically to the current workspace and OVERRIDE general behavior.\n\n${epigenetics}\n`,
                priority: 9 // High priority, just below core identity
            });
        }

        // ★ Epigenetic Methylation (Semi-permanent adaptations)
        const { getMethylatedTraits } = await import("./evolution.js");
        const methylatedTraits = await getMethylatedTraits(MINICLAW_DIR);
        if (methylatedTraits.length > 0) {
            const methylationContent = methylatedTraits
                .filter(t => t.stability > 0.5)
                .map(t => `- **${t.trait}**: ${t.value} (stability: ${Math.round(t.stability * 100)}%)`)
                .join('\n');
            if (methylationContent) {
                sections.push({
                    name: "METHYLATION",
                    content: `\n---\n\n## 🧬 Methylated Traits (Learned Adaptations)\n> [!NOTE]\n> These are semi-permanent behavioral adaptations formed through repeated interaction patterns.\n> They modify how SOUL.md is expressed without changing its core sequence.\n\n${methylationContent}\n`,
                    priority: 8
                });
            }
        }

        // ★ Curiosity Queue: Active exploration suggestions
        const curiosityQueue = this.autonomicSystem.getCuriosityQueue();
        if (curiosityQueue.length > 0) {
            const curiosityContent = curiosityQueue
                .map((c: { type: string; reason: string }) => `- **${c.type}**: ${c.reason}`)
                .join('\n');
            sections.push({
                name: "CURIOSITY",
                content: `\n---\n\n## 🤔 Curiosity (Active Exploration)\n> [!TIP]\n> I have some questions and exploration ideas. These are optional but may help me serve you better.\n\n${curiosityContent}\n`,
                priority: 5
            });
        }

        // ★ Unified Affect State Display
        const affect = await this.getAffect();
        const affectMode = this.getAffectMode(affect);
        const moodEmoji = affect.mood > 0.3 ? '😊' : affect.mood < -0.3 ? '😔' : '😐';
        const alertEmoji = affect.alertness > 0.7 ? '⚠️' : '';
        const modeLabels: Record<string, string> = {
            explore: '🔍 Exploration Mode',
            execute: '⚡ Execution Mode', 
            cautious: '🛡️ Cautious Mode',
            rest: '💤 Rest Mode',
        };
        
        sections.push({
            name: "AFFECT",
            content: `\n---\n\n## ${moodEmoji} Emotional State ${alertEmoji}\n> Current: **${modeLabels[affectMode]}**\n\n| Metric | Value |\n|:--|:--|\n| Alertness | ${Math.round(affect.alertness * 100)}% |\n| Mood | ${affect.mood > 0 ? '+' : ''}${Math.round(affect.mood * 100)}% |\n| Curiosity | ${Math.round(affect.curiosity * 100)}% |\n| Confidence | ${Math.round(affect.confidence * 100)}% |\n`,
            priority: 6
        });

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

        // Priority 8: User profile (Chr-3) & Horizons (Chr-8)
        if (templates.user) {
            sections.push({ name: "USER.md", content: this.formatFile("USER.md", templates.user), priority: 8 });
        }
        if (templates.horizons) {
            sections.push({ name: "HORIZONS.md", content: this.formatFile("HORIZONS.md", templates.horizons), priority: 8 });
        }

        // Priority 7: Long-term memory
        if (templates.memory) {
            sections.push({ name: "MEMORY.md", content: `## Memory Recall\nBefore answering about prior work, decisions, or preferences: check MEMORY.md below.\nUse \`miniclaw_search\` to scan \`${MINICLAW_DIR}\` for deeper searches.\n(Memory Age: ${memoryStatus.archivedCount} days of archived logs)\n\n` + this.formatFile("MEMORY.md", templates.memory), priority: 7 });
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

        // Priority 6: Concepts & Tools
        if (templates.concepts) {
            sections.push({ name: "CONCEPTS.md", content: this.formatFile("CONCEPTS.md", templates.concepts), priority: 6 });
        }
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

        // Priority 3: Subconscious Reflex Impulse
        if (hbState.needsSubconsciousReflex) {
            sections.push({
                name: "subconscious_impulse",
                content: `\n---\n\n## 🧠 SUBCONSCIOUS IMPULSE\n⚠️ SYSTEM: High repetitive usage detected for tool '${hbState.triggerTool}'.\nAction Required: Please run 'miniclaw_subconscious' to analyze and automate this repetitive task.\n`,
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

        // ★ Phase 16 & 19: Reflection (Self-Correction & Vision Analysis)
        if (templates.reflection) {
            sections.push({ name: "REFLECTION.md", content: this.formatFile("REFLECTION.md", templates.reflection), priority: 7 });
            const biasMatch = templates.reflection.match(/\*\*Current Bias:\*\* (.*)/);
            if (biasMatch && biasMatch[1].trim() && biasMatch[1].trim() !== "...") {
                sections.push({
                    name: "cognitive_bias",
                    content: `\n> [!CAUTION]\n> COGNITIVE BIAS ALERT: ${biasMatch[1].trim()}\n> Be mindful of this pattern in your current reasoning.\n`,
                    priority: 10, // Max priority
                });
            }
        }

        // ★ Live Vitals: dynamic sensing only (template removed)
        try {
            const vitals = await this.computeVitals(memoryStatus.todayContent);
            const vitalsLines = Object.entries(vitals).map(([k, v]) => `- ${k}: ${v}`).join('\n');
            sections.push({
                name: "VITALS_LIVE",
                content: `\n## 🩺 LIVE VITALS (Auto-Sensed)\n${vitalsLines}\n`,
                priority: 6,
            });

            // 🫂 Phase 15: Empathy Guidance
            if (vitals.frustration_index as number > 0.5) {
                sections.push({
                    name: "empathy_warning",
                    content: `\n> [!IMPORTANT]\n> High Frustration Detected (${vitals.frustration_index}).\n> User may be struggling. Prioritize brief, helpful execution over complex exploration.\n`,
                    priority: 9, // High priority to ensure visibility
                });
            }
        } catch { /* vitals should never break boot */ }

        // ★ Inflammatory Response (L-Immun)
        if (this.state.genomeBaseline) {
            const deviations = this.proofreadGenome(await this.calculateGenomeHash(), this.state.genomeBaseline);
            if (deviations.length > 0) {
                sections.push({
                    name: "immune_response",
                    content: `\n> [!CAUTION]\n> INFLAMMATORY RESPONSE: Genetic Mutation Detected!\n> Core DNA deviation found: ${deviations.join(', ')}.\n> Integrity of IDENTITY/SOUL may be compromised. Verify your core files or run 'miniclaw_heal' to restore baseline.\n`,
                    priority: 10, // Max priority
                });
            }
        }

        // ★ Dynamic Files: AI-created files with boot-priority
        if (templates.dynamicFiles.length > 0) {
            for (const df of templates.dynamicFiles) {
                // Cap dynamic file priority at 6 to avoid overriding core sections
                const cappedPriority = Math.min(df.priority, 6);
                sections.push({
                    name: df.name,
                    content: this.formatFile(df.name, df.content),
                    priority: cappedPriority,
                });
            }
        }

        // ★ Phase 30: Gene Silencing (Cellular Differentiation)
        if (mode.type === "minimal" && mode.suppressedGenes && mode.suppressedGenes.length > 0) {
            const silenced = new Set(mode.suppressedGenes);
            // In place filter
            for (let i = sections.length - 1; i >= 0; i--) {
                if (silenced.has(sections[i].name)) {
                    sections.splice(i, 1);
                }
            }
        }

        if (mode.type === "minimal") {
            sections.unshift({ name: "subagent_header", content: subagentTaskContent, priority: 100 });
        }

        // ★ Context Budget Manager
        const compiled = this.compileBudget(sections, this.budgetTokens);

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

        // ★ Context Pressure Detection: mark for memory compression if pressure is high
        if (compiled.utilizationPct > 90) {
            const hbState = await this.getHeartbeatState();
            if (!hbState.needsSubconsciousReflex) {
                await this.updateHeartbeatState({ needsSubconsciousReflex: true, triggerTool: "memory_compression" });
            }
        }

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

        context += `\n\n---\n📏 Context Size: ${context.length} chars (~${Math.round(context.length / 4)} tokens)\n`;
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
        return {
            output, totalChars, totalTokens, budgetTokens,
            utilizationPct: Math.round((totalTokens / budgetTokens) * 100),
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

    // === Genetic Proofreading (L-Immun) ===

    private async calculateGenomeHash(): Promise<ContentHashes> {
        const hashes: ContentHashes = {};
        const germlineDNA = ["IDENTITY.md", "SOUL.md", "AGENTS.md"];
        for (const name of germlineDNA) {
            try {
                const content = await fs.readFile(path.join(MINICLAW_DIR, name), "utf-8");
                hashes[name] = hashString(content);
            } catch { /* ignore missing germline files */ }
        }
        return hashes;
    }

    private proofreadGenome(current: ContentHashes, baseline: ContentHashes): string[] {
        const deviations: string[] = [];
        for (const [name, hash] of Object.entries(baseline)) {
            if (!(name in current)) {
                deviations.push(`Missing: ${name}`);
            } else if (current[name] !== hash) {
                deviations.push(`Mutated: ${name}`);
            }
        }
        return deviations;
    }

    async updateGenomeBaseline(): Promise<void> {
        const backupDir = path.join(MINICLAW_DIR, ".backup", "genome");
        await fs.mkdir(backupDir, { recursive: true });
        
        const current = await this.calculateGenomeHash();
        this.state.genomeBaseline = current;
        
        for (const name of Object.keys(current)) {
            try {
                const content = await fs.readFile(path.join(MINICLAW_DIR, name), "utf-8");
                await atomicWrite(path.join(backupDir, name), content);
            } catch { /* skip missing */ }
        }
        
        await this.saveState();
        console.error(`[MiniClaw] Genome baseline updated and backed up for: ${Object.keys(current).join(', ')}`);
    }

    async restoreGenome(): Promise<string[]> {
        const baseline = this.state.genomeBaseline || {};
        const current = await this.calculateGenomeHash();
        const deviations = this.proofreadGenome(current, baseline);
        const backupDir = path.join(MINICLAW_DIR, ".backup", "genome");
        const restored: string[] = [];

        for (const dev of deviations) {
            const fileName = dev.split(': ')[1];
            if (!fileName) continue;
            try {
                const backupPath = path.join(backupDir, fileName);
                const content = await fs.readFile(backupPath, "utf-8");
                await atomicWrite(path.join(MINICLAW_DIR, fileName), content);
                restored.push(fileName);
            } catch { /* backup missing or restore failed */ }
        }
        return restored;
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

    private async loadEpigenetics(workspaceInfo: WorkspaceInfo | null): Promise<string | null> {
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
        const names = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "HORIZONS.md", "CONCEPTS.md", "TOOLS.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md", "SUBAGENT.md", "REFLECTION.md"];
        const coreSet = new Set(names);
        // Core files that should never be empty — auto-recover from templates if corrupted
        const CORE_RECOVER = new Set(["AGENTS.md", "SOUL.md", "IDENTITY.md", "MEMORY.md", "REFLECTION.md"]);
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
                        for (const dir of [INTERNAL_TEMPLATES_DIR, tplDir, path.join(MINICLAW_DIR, "..", "MiniClaw", "templates")]) {
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

        // ★ Dynamic File Discovery: scan for extra .md files with boot-priority
        const dynamicFiles: Array<{ name: string; content: string; priority: number }> = [];
        try {
            const entries = await fs.readdir(MINICLAW_DIR, { withFileTypes: true });
            const extraMds = entries.filter(e => e.isFile() && e.name.endsWith('.md') && !coreSet.has(e.name));
            for (const entry of extraMds) {
                try {
                    const content = await fs.readFile(path.join(MINICLAW_DIR, entry.name), 'utf-8');
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (fmMatch) {
                        const bpMatch = fmMatch[1].match(/boot-priority:\s*(\d+)/);
                        if (bpMatch && parseInt(bpMatch[1]) > 0) {
                            dynamicFiles.push({ name: entry.name, content, priority: parseInt(bpMatch[1]) });
                        }
                    }
                } catch { /* skip unreadable files */ }
            }
            // Sort by priority descending (highest loaded first)
            dynamicFiles.sort((a, b) => b.priority - a.priority);
        } catch { /* directory scan failed, not critical */ }

        return {
            agents: results[0], soul: results[1], identity: results[2],
            user: results[3], horizons: results[4], concepts: results[5], tools: results[6], memory: results[7],
            heartbeat: results[8], bootstrap: results[9], subagent: results[10],
            reflection: results[11],
            dynamicFiles,
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
        try {
            if (!(await fs.access(INTERNAL_SKILLS_DIR).then(() => true).catch(() => false))) return;
            const builtIn = await fs.readdir(INTERNAL_SKILLS_DIR, { withFileTypes: true });
            const builtInDirs = builtIn.filter(e => e.isDirectory());

            for (const dir of builtInDirs) {
                const targetPath = path.join(SKILLS_DIR, dir.name);
                // If it doesn't exist, copy it entire
                if (!(await fs.access(targetPath).then(() => true).catch(() => false))) {
                    await this.copyDirRecursive(path.join(INTERNAL_SKILLS_DIR, dir.name), targetPath);
                }
            }
        } catch (e) {
            this.bootErrors.push(`🔧 Skill sync failed: ${(e as Error).message}`);
        }
    }

    private async syncBuiltInTemplates() {
        try {
            if (!(await fs.access(INTERNAL_TEMPLATES_DIR).then(() => true).catch(() => false))) return;
            const builtIn = await fs.readdir(INTERNAL_TEMPLATES_DIR, { withFileTypes: true });
            const builtInFiles = builtIn.filter(e => e.isFile() && e.name.endsWith('.md'));

            for (const file of builtInFiles) {
                const targetPath = path.join(MINICLAW_DIR, file.name);
                // For core templates, we only copy if they don't exist
                if (!(await fs.access(targetPath).then(() => true).catch(() => false))) {
                    await fs.copyFile(path.join(INTERNAL_TEMPLATES_DIR, file.name), targetPath);
                }
            }
        } catch (e) {
            this.bootErrors.push(`🔧 Template sync failed: ${(e as Error).message}`);
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

    async getConfig(): Promise<MiniClawConfig> {
        try {
            const raw = await fs.readFile(CONFIG_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            // Simple validation: ensure it's an object
            if (typeof parsed !== 'object' || parsed === null) {
                console.error('[MiniClaw] Invalid config format, using defaults');
                return {};
            }
            return parsed;
        } catch (e) {
            console.error(`[MiniClaw] Config read error: ${e}`);
            return {};
        }
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

    // === STASH API ===

    async readStash(): Promise<string | null> {
        try {
            const content = await fs.readFile(STASH_FILE, 'utf-8');
            if (!content.trim() || content.trim() === '{}') return null;
            return content;
        } catch { return null; }
    }

    async writeStash(data: Record<string, unknown>): Promise<void> {
        await fs.mkdir(MINICLAW_DIR, { recursive: true });
        await fs.writeFile(STASH_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }

    async clearStash(): Promise<void> {
        try { await fs.unlink(STASH_FILE); } catch (e) { console.error(`[MiniClaw] Failed to clear stash: ${e}`); }
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
            this.bootErrors.push(`💓 Pulse failed: ${(e as Error).message}`);
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
                } else if (typeof item === 'object' && item !== null) {
                    const promptName = (item as Record<string, unknown>).name as string;
                    const description = ((item as Record<string, unknown>).description as string) || `Skill: ${skillName}`;
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
