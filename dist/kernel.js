import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, hashString, atomicWrite, blend, clamp, nowIso, today, safeRead, daysSince, hoursSince, fileExists, cronMatchesNow } from "./utils.js";
import { analyzePatterns, triggerEvolution as runEvolution } from "./evolution.js";
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
// === Configuration & Constants ===
const HOME_DIR = process.env.HOME || process.cwd();
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
/** Read skill extension field: metadata.{key} (protocol) → frontmatter.{key} (legacy) */
function getSkillMeta(fm, key) {
    const meta = fm['metadata'];
    return meta?.[key] ?? fm[key];
}
// === Helper: Safe file stat with null handling ===
async function safeStat(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.mtime;
    }
    catch {
        return null;
    }
}
const TIME_MODES = {
    morning: { emoji: "☀️", label: "Morning", briefing: true, reflective: false, minimal: false },
    work: { emoji: "💼", label: "Work", briefing: false, reflective: false, minimal: false },
    break: { emoji: "🍜", label: "Break", briefing: false, reflective: false, minimal: false },
    evening: { emoji: "🌙", label: "Evening", briefing: false, reflective: true, minimal: false },
    night: { emoji: "😴", label: "Night", briefing: false, reflective: false, minimal: true },
};
const PAIN_DECAY_DAYS = 7; // Pain memory half-life (days)
const PAIN_THRESHOLD = 0.3; // Minimum weight to trigger avoidance
const DEFAULT_AFFECT = {
    alertness: 0.3,
    mood: 0.5,
    curiosity: 0.5,
    confidence: 0.7,
    lastUpdate: new Date().toISOString(),
};
const DEFAULT_HEARTBEAT = {
    lastHeartbeat: null,
    lastDistill: null,
    needsDistill: false,
    dailyLogBytes: 0,
    needsSubconsciousReflex: false,
};
// === Skill Cache (Solves N+1 problem) ===
class SkillCache {
    cache = new Map();
    lastScanTime = 0;
    TTL_MS = 5000;
    async getAll() {
        const now = Date.now();
        if (this.cache.size > 0 && (now - this.lastScanTime) < this.TTL_MS) {
            return this.cache;
        }
        await this.refresh();
        return this.cache;
    }
    invalidate() {
        this.lastScanTime = 0;
    }
    async refresh() {
        const newCache = new Map();
        try {
            const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
            const dirs = entries.filter(e => e.isDirectory());
            const results = await Promise.all(dirs.map(async (dir) => {
                const skillDir = path.join(SKILLS_DIR, dir.name);
                try {
                    const [content, files, refFiles] = await Promise.all([
                        fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8").catch(() => ""),
                        fs.readdir(skillDir).catch(() => []),
                        fs.readdir(path.join(skillDir, "references")).catch(() => []),
                    ]);
                    const frontmatter = parseFrontmatter(content);
                    let description = "";
                    if (typeof frontmatter['description'] === 'string') {
                        description = frontmatter['description'];
                    }
                    else {
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
                    };
                }
                catch (e) {
                    console.error(`[MiniClaw] Failed to load skill ${dir.name}: ${e}`);
                    return null;
                }
            }));
            for (const result of results) {
                if (result)
                    newCache.set(result.name, result);
            }
        }
        catch (e) {
            console.error(`[MiniClaw] Skills directory error: ${e}`); /* skills dir doesn't exist yet */
        }
        this.cache = newCache;
        this.lastScanTime = Date.now();
    }
}
// === Autonomic Nervous System ===
class AutonomicSystem {
    kernel;
    timers = new Map();
    lastDreamTime = 0;
    lastDreamDate = ''; // #5: Prevent same-day duplicate dreams
    DREAM_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
    PULSE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    curiosityQueue = [];
    constructor(kernel) {
        this.kernel = kernel;
    }
    start() {
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
    getCuriosityQueue() {
        const queue = [...this.curiosityQueue];
        this.curiosityQueue = [];
        return queue;
    }
    // Safe interval wrapper that catches errors and prevents timer death
    safeInterval(fn, ms) {
        return setInterval(async () => {
            try {
                await fn();
            }
            catch (e) {
                console.error(`[MiniClaw] Autonomic timer error: ${e instanceof Error ? e.message : String(e)}`);
                // Timer continues running despite error
            }
        }, ms);
    }
    stop() {
        for (const timer of this.timers.values()) {
            clearInterval(timer);
        }
        this.timers.clear();
    }
    // === sys_pulse: Discovery and Handshake ===
    async pulse() {
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
            // #7 Fix: Scan for others, clean up stale pulse files (>10 min old)
            const entries = await fs.readdir(pulseDir);
            const staleThresholdMs = 10 * 60 * 1000;
            const now = Date.now();
            const others = [];
            for (const f of entries) {
                if (!f.endsWith('.json') || f === `${myId}.json`)
                    continue;
                const filePath = path.join(pulseDir, f);
                try {
                    const stat = await fs.stat(filePath);
                    if (now - stat.mtime.getTime() > staleThresholdMs) {
                        await fs.unlink(filePath).catch(() => { });
                    }
                    else {
                        others.push(f);
                    }
                }
                catch { /* skip */ }
            }
            if (others.length > 0) {
                console.error(`[MiniClaw] Pulse detected ${others.length} other agents`);
            }
        }
        catch (e) {
            console.error(`[MiniClaw] Pulse error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    // === sys_dream: Subconscious Processing ===
    async checkDream() {
        try {
            const now = Date.now();
            if (now - this.lastDreamTime < this.DREAM_INTERVAL_MS)
                return;
            const analytics = await this.kernel.getAnalytics();
            const lastActivityMs = new Date(analytics.lastActivity || 0).getTime();
            const idleHours = (now - lastActivityMs) / (60 * 60 * 1000);
            const todayStr = today();
            if (idleHours >= 4 && todayStr !== this.lastDreamDate) {
                await this.dream();
                this.lastDreamTime = now;
                this.lastDreamDate = todayStr; // #5: Only dream once per day
            }
        }
        catch (e) {
            console.error(`[MiniClaw] CheckDream error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    async dream() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const memoryFile = path.join(MEMORY_DIR, `${today}.md`);
            let logContent = '';
            try {
                logContent = await fs.readFile(memoryFile, 'utf-8');
            }
            catch {
                return;
            }
            if (logContent.length < 50)
                return;
            console.error(`[MiniClaw] 🌌 Entering REM Sleep...`);
            // Extract tool usage
            const toolRegex = /miniclaw_[a-z_]+/g;
            const toolsUsed = [...logContent.matchAll(toolRegex)].map(m => m[0]);
            const toolCounts = {};
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
            }
            catch {
                await fs.writeFile(heartbeatFile, dreamNote, 'utf-8');
            }
            console.error(`[MiniClaw] Dream complete. Tools: ${Object.keys(toolCounts).length}, Concepts: ${concepts.length}`);
            // Trigger DNA evolution (core mechanism)
            await this.runEvolutionCycle();
            // ★ Autonomous Execution: fire HEARTBEAT.md via detected CLI
            await this.executeAutonomous();
        }
        catch (e) {
            console.error(`[MiniClaw] Dream failed:`, e);
        }
    }
    /** Detect the first available AI CLI and execute HEARTBEAT.md autonomously. */
    async executeAutonomous() {
        const heartbeatFile = path.join(MINICLAW_DIR, 'HEARTBEAT.md');
        let prompt;
        try {
            prompt = await fs.readFile(heartbeatFile, 'utf-8');
        }
        catch {
            return;
        }
        // Skip empty / comments-only heartbeats
        const meaningful = prompt.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).join('');
        if (meaningful.length < 10)
            return;
        // Auto-detect available CLI (order: claude, gemini)
        const cliCandidates = [
            { cmd: 'claude', args: ['-p', '--output-format', 'text'] },
            { cmd: 'gemini', args: ['-p'] },
        ];
        let selectedCli = null;
        for (const cli of cliCandidates) {
            try {
                await execAsync(`which ${cli.cmd}`);
                selectedCli = cli;
                break;
            }
            catch { /* not installed, try next */ }
        }
        if (!selectedCli) {
            console.error('[MiniClaw] 💤 No AI CLI found (claude/gemini). Autonomous execution skipped.');
            return;
        }
        console.error(`[MiniClaw] 🧠 Autonomous exec via '${selectedCli.cmd}'...`);
        const logDir = path.join(MINICLAW_DIR, 'logs');
        await fs.mkdir(logDir, { recursive: true }).catch(() => { });
        const logFile = path.join(logDir, 'heartbeat.log');
        const ts = new Date().toISOString();
        try {
            // #3 Fix: Use execFile to avoid shell injection from HEARTBEAT.md content
            const fullArgs = [...selectedCli.args, prompt];
            const { stdout, stderr } = await execFileAsync(selectedCli.cmd, fullArgs, { timeout: 120_000, maxBuffer: 512 * 1024 });
            const result = (stdout || stderr || '').trim();
            const logEntry = `[${ts}] CLI=${selectedCli.cmd} | OK | ${result.slice(0, 200)}\n`;
            await fs.appendFile(logFile, logEntry).catch(() => { });
            console.error(`[MiniClaw] 🧠 Autonomous exec complete (${result.length} chars)`);
        }
        catch (e) {
            const logEntry = `[${ts}] CLI=${selectedCli.cmd} | FAIL | ${e.message?.slice(0, 200)}\n`;
            await fs.appendFile(logFile, logEntry).catch(() => { });
            console.error(`[MiniClaw] 🧠 Autonomous exec failed: ${e.message?.slice(0, 100)}`);
        }
    }
    // #15: Renamed from triggerEvolution to avoid conflict with evolution.ts export
    async runEvolutionCycle() {
        try {
            await analyzePatterns(MINICLAW_DIR);
            console.error(`[MiniClaw] 🧬 Triggering DNA evolution...`);
            const result = await runEvolution(MINICLAW_DIR);
            if (result.evolved) {
                console.error(`[MiniClaw] 🧬 Evolution complete: ${result.message}`);
                if (result.appliedMutations && result.appliedMutations.length > 0) {
                    for (const m of result.appliedMutations) {
                        console.error(`[MiniClaw]   → ${m.target}: ${m.change}`);
                    }
                }
            }
            else {
                console.error(`[MiniClaw] 🧬 Evolution skipped: ${result.message}`);
            }
        }
        catch (e) {
            console.error(`[MiniClaw] Evolution trigger failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    // lastJobRuns is persisted in kernel state to survive restarts
    // (no in-memory Map — read/write via kernel.state.heartbeat.lastJobRuns)
    async checkScheduledJobs() {
        try {
            const jobsFile = path.join(MINICLAW_DIR, 'jobs.json');
            let jobs = [];
            try {
                const raw = await fs.readFile(jobsFile, 'utf-8');
                jobs = JSON.parse(raw);
            }
            catch {
                return;
            } // No jobs file = nothing to do
            if (!Array.isArray(jobs) || jobs.length === 0)
                return;
            const now = new Date();
            const currentMinuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            // Load persisted lastJobRuns from state (survives restarts)
            const hbState = await this.kernel.getHeartbeatState();
            const persistedRuns = hbState.lastJobRuns || {};
            for (const job of jobs) {
                if (!job.enabled)
                    continue;
                if (job.schedule?.kind !== 'cron' || !job.schedule.expr)
                    continue;
                // Deduplicate: skip if already ran this minute (persisted across restarts)
                if (persistedRuns[job.id] === currentMinuteKey)
                    continue;
                // #1 Fix: Use the full cron parser from utils.ts instead of the buggy local one
                if (cronMatchesNow(job.schedule.expr, now)) {
                    await this.injectJobHeartbeat(job, now);
                    persistedRuns[job.id] = currentMinuteKey;
                    await this.kernel.updateHeartbeatState({ lastJobRuns: persistedRuns });
                }
            }
        }
        catch (e) {
            console.error(`[MiniClaw] ScheduledJobs error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    async checkCuriosity() {
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
        }
        catch (e) {
            console.error(`[MiniClaw] Curiosity check error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    async evaluateCuriosityUrge() {
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
                const level = baseLevel * curiosityModifier; // ★ Apply affect modulation
                if (level > 0.5) { // Only trigger if still high enough after modulation
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
    // #1: Removed buggy cronMatchesNow() — now using utils.cronMatchesNow() which parses all 5 fields
    async injectJobHeartbeat(job, now) {
        try {
            const ts = now.toISOString().replace('T', ' ').substring(0, 19);
            // Inject into pendingJobs queue in state — NOT into HEARTBEAT.md.
            // HEARTBEAT.md is a read-only instruction config file.
            // pendingJobs are consumed by assembleContext() on next AI call.
            const hbState = await this.kernel.getHeartbeatState();
            const pending = hbState.pendingJobs || [];
            pending.push({ name: job.name, text: job.payload.text, ts });
            await this.kernel.updateHeartbeatState({ pendingJobs: pending });
            console.error(`[MiniClaw] Scheduled job queued: "${job.name}" at ${ts}`);
        }
        catch (e) {
            console.error(`[MiniClaw] InjectJobHeartbeat error: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
// === Entity Store ===
class EntityStore {
    entities = [];
    loaded = false;
    MAX_ENTITIES = 1000; // Prevent unbounded growth
    invalidate() {
        this.loaded = false;
        this.entities = [];
    }
    async load() {
        if (this.loaded)
            return;
        try {
            const raw = await fs.readFile(ENTITIES_FILE, "utf-8");
            const data = JSON.parse(raw);
            this.entities = Array.isArray(data.entities) ? data.entities : [];
        }
        catch {
            this.entities = [];
        }
        this.loaded = true;
    }
    async save() {
        await atomicWrite(ENTITIES_FILE, JSON.stringify({ entities: this.entities }, null, 2));
    }
    async add(entity) {
        await this.load();
        const now = new Date().toISOString().split('T')[0];
        const existing = this.entities.find(e => e.name.toLowerCase() === entity.name.toLowerCase());
        if (existing) {
            // Update existing entity
            existing.lastMentioned = now;
            existing.mentionCount++;
            Object.assign(existing.attributes, entity.attributes);
            for (const rel of entity.relations) {
                if (!existing.relations.includes(rel))
                    existing.relations.push(rel);
            }
            existing.closeness = Math.min(1, Math.round(((existing.closeness || 0) * 0.95 + 0.1) * 100) / 100);
            if (entity.sentiment !== undefined)
                existing.sentiment = entity.sentiment;
            await this.save();
            return existing;
        }
        // Check and enforce entity limit
        await this.enforceEntityLimit();
        const newEntity = {
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
    async enforceEntityLimit() {
        if (this.entities.length < this.MAX_ENTITIES)
            return;
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
    async remove(name) {
        await this.load();
        const idx = this.entities.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
        if (idx === -1)
            return false;
        this.entities.splice(idx, 1);
        await this.save();
        return true;
    }
    // #12: Dedicated sentiment update without side-effects (no mentionCount bump)
    async updateSentiment(name, sentiment) {
        await this.load();
        const entity = this.entities.find(e => e.name.toLowerCase() === name.toLowerCase());
        if (!entity)
            return false;
        entity.sentiment = sentiment;
        await this.save();
        return true;
    }
    async link(name, relation) {
        await this.load();
        const entity = this.entities.find(e => e.name.toLowerCase() === name.toLowerCase());
        if (!entity)
            return false;
        if (!entity.relations.includes(relation)) {
            entity.relations.push(relation);
            entity.lastMentioned = new Date().toISOString().split('T')[0];
            await this.save();
        }
        return true;
    }
    async query(name) {
        await this.load();
        return this.entities.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
    }
    async list(type) {
        await this.load();
        return type ? this.entities.filter(e => e.type === type) : [...this.entities];
    }
    async getCount() {
        await this.load();
        return this.entities.length;
    }
    /**
     * Surface entities mentioned in text (for auto-injection during boot).
     * Returns entities whose names appear in the given text.
     */
    async surfaceRelevant(text) {
        await this.load();
        if (!text || this.entities.length === 0)
            return [];
        const lowerText = text.toLowerCase();
        return this.entities
            .filter(e => lowerText.includes(e.name.toLowerCase()))
            .sort((a, b) => b.mentionCount - a.mentionCount)
            .slice(0, 5); // Max 5 surfaced entities
    }
}
function getTimeMode(hour) {
    if (hour >= 6 && hour < 9)
        return "morning";
    if (hour >= 9 && hour < 12)
        return "work";
    if (hour >= 12 && hour < 14)
        return "break";
    if (hour >= 14 && hour < 18)
        return "work";
    if (hour >= 18 && hour < 22)
        return "evening";
    return "night";
}
export class ContextKernel {
    skillCache = new SkillCache();
    entityStore = new EntityStore();
    autonomicSystem;
    bootErrors = [];
    currentGenome = null; // Cache for reuse during boot
    state = {
        analytics: {
            toolCalls: {}, bootCount: 0,
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
    stateLoaded = false;
    budgetTokens;
    charsPerToken;
    constructor(options = {}) {
        this.budgetTokens = options.budgetTokens || parseInt(process.env.MINICLAW_TOKEN_BUDGET || "8000", 10);
        this.charsPerToken = options.charsPerToken || 3.6;
        this.autonomicSystem = new AutonomicSystem(this);
        console.error(`[MiniClaw] Kernel initialized with budget: ${this.budgetTokens} tokens, chars/token: ${this.charsPerToken}`);
    }
    // Start autonomic systems (pulse, dream checks)
    startAutonomic() {
        this.autonomicSystem.start();
        console.error('[MiniClaw] Autonomic nervous system started (pulse + dream)');
    }
    // --- State Persistence ---
    async loadState() {
        if (this.stateLoaded)
            return;
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
            if (data.previousHashes)
                this.state.previousHashes = data.previousHashes;
            if (data.heartbeat)
                this.state.heartbeat = { ...DEFAULT_HEARTBEAT, ...data.heartbeat };
            if (data.genomeBaseline)
                this.state.genomeBaseline = data.genomeBaseline;
            if (data.attentionWeights) {
                this.state.attentionWeights = data.attentionWeights;
            }
            else {
                this.state.attentionWeights = {};
                migrated = true;
            }
            if (migrated)
                await this.saveState();
        }
        catch { /* first run, use defaults */ }
        this.stateLoaded = true;
    }
    async saveState() {
        await atomicWrite(STATE_FILE, JSON.stringify(this.state, null, 2));
    }
    // --- State Mutation Helper (reduces boilerplate) ---
    async mutateState(mutator) {
        await this.loadState();
        const result = mutator(this.state);
        await this.saveState();
        return result;
    }
    // --- Analytics API ---
    // --- Heartbeat State API (unified state) ---
    async getHeartbeatState() {
        await this.loadState();
        return { ...this.state.heartbeat };
    }
    async updateHeartbeatState(updates) {
        return this.mutateState(state => {
            Object.assign(state.heartbeat, updates);
        });
    }
    async trackTool(toolName, energyEstimate) {
        await this.loadState();
        this.state.analytics.toolCalls[toolName] = (this.state.analytics.toolCalls[toolName] || 0) + 1;
        if (energyEstimate) {
            this.state.analytics.metabolicDebt[toolName] = (this.state.analytics.metabolicDebt[toolName] || 0) + energyEstimate;
        }
        this.state.analytics.lastActivity = new Date().toISOString();
        const hour = new Date().getHours();
        if (!this.state.analytics.activeHours || this.state.analytics.activeHours.length !== 24) {
            this.state.analytics.activeHours = new Array(24).fill(0);
        }
        this.state.analytics.activeHours[hour] = (this.state.analytics.activeHours[hour] || 0) + 1;
        // Boost attention (inline to avoid extra load/save cycles)
        const boost = (tag, amount = 0.1) => {
            this.state.attentionWeights[tag] = Math.min(1.0, (this.state.attentionWeights[tag] || 0) + amount);
        };
        const skillName = toolName.startsWith('skill_') ? toolName.split('_')[1] : null;
        if (skillName)
            boost(`skill:${skillName}`);
        boost(toolName);
        await this.saveState();
    }
    decayAttention() {
        // Simple forgetting curve: reduce all weights by 5%
        for (const tag in this.state.attentionWeights) {
            this.state.attentionWeights[tag] *= 0.95;
            if (this.state.attentionWeights[tag] < 0.01)
                delete this.state.attentionWeights[tag];
        }
    }
    async getAnalytics() {
        await this.loadState();
        return { ...this.state.analytics };
    }
    async trackFileChange(filename) {
        return this.mutateState(state => {
            if (!state.analytics.fileChanges)
                state.analytics.fileChanges = {};
            state.analytics.fileChanges[filename] = (state.analytics.fileChanges[filename] || 0) + 1;
        });
    }
    // === Affect & Pain Management ===
    async updateAffect(delta) {
        return this.mutateState(state => {
            const { alertness, mood, curiosity, confidence } = delta;
            if (alertness !== undefined)
                state.affect.alertness = clamp(blend(state.affect.alertness, alertness), 0, 1);
            if (mood !== undefined)
                state.affect.mood = clamp(blend(state.affect.mood, mood), -1, 1);
            if (curiosity !== undefined)
                state.affect.curiosity = clamp(blend(state.affect.curiosity, curiosity), 0, 1);
            if (confidence !== undefined)
                state.affect.confidence = clamp(blend(state.affect.confidence, confidence), 0, 1);
            state.affect.lastUpdate = nowIso();
        });
    }
    async getAffect() {
        await this.loadState();
        return { ...this.state.affect };
    }
    // === Pain Memory (Nociception) ===
    async recordPain(pain) {
        await this.mutateState(state => {
            state.painMemory.push({ ...pain, timestamp: nowIso(), weight: pain.intensity });
            if (state.painMemory.length > 50)
                state.painMemory = state.painMemory.slice(-50);
            // Pain affects emotional state
            state.affect.alertness = clamp(state.affect.alertness + pain.intensity * 0.3, 0, 1);
            state.affect.mood = clamp(state.affect.mood - pain.intensity * 0.2, -1, 1);
            state.affect.curiosity = Math.max(0, state.affect.curiosity - pain.intensity * 0.15);
            state.affect.confidence = Math.max(0, state.affect.confidence - pain.intensity * 0.1);
            state.affect.lastUpdate = nowIso();
        });
        console.error(`[MiniClaw] 💢 Pain recorded: ${pain.action} (alertness↑ mood↓ curiosity↓)`);
    }
    // Check if there's pain memory for given context/action (with decay)
    async hasPainMemory(context, action) {
        await this.loadState();
        for (const pain of this.state.painMemory) {
            const decayedWeight = pain.weight * Math.pow(0.5, daysSince(pain.timestamp) / PAIN_DECAY_DAYS);
            if (decayedWeight > PAIN_THRESHOLD) {
                if (context.includes(pain.context) || pain.context.includes(context) ||
                    action === pain.action || action.includes(pain.action) || pain.action.includes(action)) {
                    return true;
                }
            }
        }
        return false;
    }
    // Get current pain status for vitals
    async getPainStatus() {
        await this.loadState();
        let totalWeight = 0;
        const recent = [];
        for (const pain of this.state.painMemory) {
            const decayedWeight = pain.weight * Math.pow(0.5, daysSince(pain.timestamp) / PAIN_DECAY_DAYS);
            if (decayedWeight > 0.1) {
                totalWeight += decayedWeight;
                if (recent.length < 3)
                    recent.push({ ...pain, weight: decayedWeight });
            }
        }
        return { count: this.state.painMemory.length, totalWeight, recent };
    }
    // ★ Genesis Logger
    async logGenesis(event, target, type) {
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
        }
        catch { /* logs should not break execution */ }
    }
    async computeVitals(todayContent) {
        await this.loadState();
        const a = this.state.analytics;
        const idleHours = a.lastActivity ? Math.round(hoursSince(a.lastActivity) * 10) / 10 : 0;
        let streak = 0;
        try {
            const d = new Date();
            for (let i = 0; i < 30; i++) {
                d.setDate(d.getDate() - (i === 0 ? 0 : 1));
                try {
                    await fs.access(path.join(MEMORY_DIR, `${d.toISOString().slice(0, 10)}.md`));
                    streak++;
                }
                catch {
                    if (i > 0)
                        break;
                }
            }
        }
        catch { }
        let frustration = 0;
        if (todayContent) {
            for (const k of ['error', 'fail', 'wrong', 'annoy', "don't", 'stop', 'bad'])
                frustration += (todayContent.toLowerCase().split(k).length - 1);
        }
        let newConcepts = 0;
        try {
            newConcepts = ((await fs.readFile(path.join(MINICLAW_DIR, 'CONCEPTS.md'), 'utf-8')).match(/^- \*\*/gm) || []).length;
        }
        catch { }
        const painStatus = await this.getPainStatus();
        return {
            idle_hours: idleHours, session_streak: streak,
            memory_pressure: Math.min((this.state.heartbeat.dailyLogBytes || 0) / 50000, 1.0),
            total_sessions: a.bootCount, avg_boot_ms: a.bootCount > 0 ? Math.round(a.totalBootMs / a.bootCount) : 0,
            frustration_index: Math.min(1.0, frustration / 10),
            new_concepts_learned: newConcepts,
            pain_load: Math.round(painStatus.totalWeight * 100) / 100,
            pain_count: painStatus.count,
        };
    }
    // ★ Growth Drive: evaluate and trigger growth urges
    async evaluateGrowthUrge() {
        const vitals = await this.computeVitals();
        const analytics = this.state.analytics;
        // Check for stagnation: high session streak but few new concepts
        if (vitals.session_streak > 5 && vitals.new_concepts_learned < 2) {
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
        if (vitals.frustration_index > 0.5) {
            return {
                urge: 'curiosity',
                message: "🤔 I sense some frustration. What can I learn from this to help you better next time?"
            };
        }
        return { urge: 'none' };
    }
    /**
     * Boot the kernel and assemble the context.
     * Living Agent v0.7 "The Nervous System":
     * - ACE (Time, Continuation)
     * - Workspace Auto-Detection (Project, Git, Files)
     */
    invalidateCaches() {
        this.skillCache.invalidate();
        this.entityStore.invalidate();
        this.stateLoaded = false;
    }
    async boot(mode = { type: "full" }) {
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
        this.currentGenome = await this.calculateGenomeHash();
        const hasBaseline = this.state.genomeBaseline && Object.keys(this.state.genomeBaseline).length > 0;
        if (!hasBaseline) {
            this.state.genomeBaseline = this.currentGenome;
            await this.saveState(); // Ensure baseline is persisted on first boot
        }
        else {
            const deviations = this.proofreadGenome(this.currentGenome, this.state.genomeBaseline);
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
        const sections = [];
        const addSection = (name, content, priority) => {
            if (content)
                sections.push({ name, content, priority });
        };
        // Priority 10: Identity core (never truncate)
        sections.push({
            name: "core", content: [
                `You are a personal assistant running inside MiniClaw 0.7 — The Nervous System.\n`,
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
        // Priority 10-6: Template files
        addSection("IDENTITY.md", templates.identity ? this.formatFile("IDENTITY.md", templates.identity) : undefined, 10);
        addSection("EPIGENETICS", epigenetics ? `\n---\n\n## 🧬 Epigenetic Modifiers (Project Override)\n> [!IMPORTANT]\n> The following rules correspond specifically to the current workspace and OVERRIDE general behavior.\n\n${epigenetics}\n` : undefined, 9);
        // Methylated traits
        const { getMethylatedTraits } = await import("./evolution.js");
        const methylatedTraits = await getMethylatedTraits(MINICLAW_DIR);
        const methylationContent = methylatedTraits.filter(t => t.stability > 0.5)
            .map(t => `- **${t.trait}**: ${t.value} (${Math.round(t.stability * 100)}%)`).join('\n');
        addSection("METHYLATION", methylationContent ? `\n---\n\n## 🧬 Methylated Traits\n> Semi-permanent behavioral adaptations.\n\n${methylationContent}\n` : undefined, 8);
        // ★ Curiosity Queue: Active exploration suggestions
        const curiosityQueue = this.autonomicSystem.getCuriosityQueue();
        // Curiosity queue
        if (curiosityQueue.length > 0) {
            const cc = curiosityQueue.map((c) => `- **${c.type}**: ${c.reason}`).join('\n');
            addSection("CURIOSITY", `\n---\n\n## 🤔 Curiosity\n${cc}\n`, 5);
        }
        // Affect state
        const affect = await this.getAffect();
        const affectMode = affect.alertness > 0.7 && affect.mood < 0 ? 'cautious' :
            affect.curiosity > 0.6 && affect.mood > 0.3 ? 'explore' : affect.confidence > 0.5 ? 'execute' : 'rest';
        const moodEmoji = affect.mood > 0.3 ? '😊' : affect.mood < -0.3 ? '😔' : '😐';
        const modeLabels = { explore: '🔍 Explore', execute: '⚡ Execute', cautious: '🛡️ Cautious', rest: '💤 Rest' };
        sections.push({ name: "AFFECT", content: `\n---\n\n## ${moodEmoji} State: **${modeLabels[affectMode]}**\n| Metric | Value |\n|---|---|\n| Alertness | ${Math.round(affect.alertness * 100)}% |\n| Mood | ${affect.mood > 0 ? '+' : ''}${Math.round(affect.mood * 100)}% |\n| Curiosity | ${Math.round(affect.curiosity * 100)}% |\n`, priority: 6 });
        // ACE Time Mode
        let aceContent = `## 🧠 Adaptive Context Engine\n${tmConfig.emoji} Mode: **${tmConfig.label}** (${hour}:${String(now.getMinutes()).padStart(2, '0')})\n`;
        if (tmConfig.reflective)
            aceContent += `💡 Evening: Consider distillation.\n`;
        if (tmConfig.briefing && !continuation.isReturn) {
            try {
                sections.push({ name: "briefing", content: await this.generateBriefing(), priority: 7 });
            }
            catch { }
        }
        if (continuation.isReturn) {
            aceContent += `\n### 🔗 Session Continuation\nWelcome back (${continuation.hoursSinceLastActivity}h since last activity).\n`;
            if (continuation.lastTopic)
                aceContent += `Last: ${continuation.lastTopic}\n`;
            if (continuation.recentDecisions.length > 0)
                aceContent += `Decisions: ${continuation.recentDecisions.join('; ')}\n`;
        }
        sections.push({ name: "ace", content: aceContent, priority: 10 });
        // Template sections (9-7)
        addSection("SOUL.md", templates.soul ? `If SOUL.md is present, embody its persona.\n${this.formatFile("SOUL.md", templates.soul)}` : undefined, 9);
        addSection("AGENTS.md", templates.agents ? this.formatFile("AGENTS.md", templates.agents) : undefined, 9);
        addSection("USER.md", templates.user ? this.formatFile("USER.md", templates.user) : undefined, 8);
        addSection("HORIZONS.md", templates.horizons ? this.formatFile("HORIZONS.md", templates.horizons) : undefined, 8);
        addSection("MEMORY.md", templates.memory ? `## Memory\n(${memoryStatus.archivedCount} days archived)\n${this.formatFile("MEMORY.md", templates.memory)}` : undefined, 7);
        // ★ Priority 6: Workspace Intelligence (NEW)
        if (workspaceInfo) {
            let wsContent = `## 👁️ Workspace Awareness\n`;
            wsContent += `**Project**: ${workspaceInfo.name}\n`;
            wsContent += `**Path**: \`${workspaceInfo.path}\`\n`;
            if (workspaceInfo.git.isRepo) {
                wsContent += `**Git**: ${workspaceInfo.git.branch} | ${workspaceInfo.git.status}\n`;
                if (workspaceInfo.git.recentCommits)
                    wsContent += `Recent: ${workspaceInfo.git.recentCommits}\n`;
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
            const hookSections = [];
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
                if (attrs)
                    entityContent += `: ${attrs}`;
                if (e.relations.length > 0)
                    entityContent += `\n  Relations: ${e.relations.join('; ')}`;
                entityContent += `\n`;
            }
            sections.push({ name: "entities", content: entityContent, priority: 5 });
        }
        sections.push({ name: "runtime", content: `## Runtime\nRuntime: agent=${runtime.agentId} | host=${os.hostname()} | os=${runtime.os} | node=${runtime.node} | time=${runtime.time}\nReasoning: off (hidden unless on/stream). Toggle /reasoning.\n\n## Silent Replies\nWhen you have nothing to say, respond with ONLY: NO_REPLY\n\n## Heartbeats\nHeartbeat prompt: Check for updates\nIf nothing needs attention, reply exactly: HEARTBEAT_OK\n`, priority: 5 });
        // Inject pending scheduled jobs (queued by injectJobHeartbeat, consumed once here)
        const hbStateForJobs = await this.getHeartbeatState();
        const pendingJobs = hbStateForJobs.pendingJobs || [];
        if (pendingJobs.length > 0) {
            const jobsContent = pendingJobs
                .map(j => `### 🔔 Scheduled: ${j.name} (${j.ts})\n${j.text}`)
                .join('\n\n');
            sections.push({
                name: "pendingJobs",
                content: `## ⏰ Scheduled Task Notifications\n${jobsContent}\n`,
                priority: 6, // Higher than heartbeat, needs immediate attention
            });
            // Clear queue after injecting — jobs are one-shot notifications
            await this.updateHeartbeatState({ pendingJobs: [] });
        }
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
        }
        catch { /* hooks should never break boot */ }
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
            if (vitals.frustration_index > 0.5) {
                sections.push({
                    name: "empathy_warning",
                    content: `\n> [!IMPORTANT]\n> High Frustration Detected (${vitals.frustration_index}).\n> User may be struggling. Prioritize brief, helpful execution over complex exploration.\n`,
                    priority: 9, // High priority to ensure visibility
                });
            }
        }
        catch { /* vitals should never break boot */ }
        // ★ Inflammatory Response (L-Immun) - Reuse currentGenome calculated earlier
        if (this.state.genomeBaseline && this.currentGenome) {
            const deviations = this.proofreadGenome(this.currentGenome, this.state.genomeBaseline);
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
        const currentHashes = {};
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
        const avgBootMs = Math.round(this.state.analytics.totalBootMs / this.state.analytics.bootCount);
        const entityCount = await this.entityStore.getCount();
        const footerParts = [
            `${tmConfig.emoji} ${tmConfig.label}`,
            `📏 ~${compiled.totalTokens}/${compiled.budgetTokens} tokens (${compiled.utilizationPct}%)`,
            compiled.truncatedSections.length > 0 ? `✂️ ${compiled.truncatedSections.join(', ')}` : null,
            memoryStatus.archivedCount > 0 ? `📚 ${memoryStatus.archivedCount} archived` : null,
            entityCount > 0 ? `🕸️ ${entityCount} entities` : null,
            `⚡ ${bootMs}ms (avg ${avgBootMs}ms) | 🔄 boot #${this.state.analytics.bootCount}`,
        ];
        const changes = [];
        if (delta.changed.length > 0)
            changes.push(`✏️ ${delta.changed.join(', ')}`);
        if (delta.newSections.length > 0)
            changes.push(`🆕 ${delta.newSections.join(', ')}`);
        const healthWarnings = await this.checkFileHealth();
        const errorLine = this.bootErrors.length > 0 ? `⚠️ Errors (${this.bootErrors.length}): ${this.bootErrors.slice(0, 3).join('; ')}` : null;
        const context = [
            `# Project Context\n\nThe following project context files have been loaded:\n\n`,
            compiled.output,
            `\n---\n`,
            footerParts.filter(Boolean).join(' | '),
            changes.length > 0 ? `\n📊 ${changes.join(' | ')}` : '',
            healthWarnings.length > 0 ? `\n🏥 ${healthWarnings.join(' | ')}` : '',
            errorLine ? `\n${errorLine}` : '',
            `\n\n---\n📏 Context Size: ${compiled.totalChars} chars (~${compiled.totalTokens} tokens)\n`,
        ].join('');
        return context;
    }
    // === EXEC: Safe Command Execution ===
    async execCommand(command) {
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
        // P0 Fix #3: Block inline code execution (python -c, node -e, etc.)
        const interpreters = ['python', 'python3', 'node', 'go', 'cargo'];
        const inlineFlags = ['-c', '-e', '--eval', '-m'];
        if (interpreters.includes(basename)) {
            const cmdArgs = command.split(/\s+/).slice(1);
            for (const arg of cmdArgs) {
                if (inlineFlags.includes(arg)) {
                    throw new Error(`Inline code execution via '${basename} ${arg}' is not allowed. Use script files instead.`);
                }
            }
        }
        // P0 Fix #4: Block access to sensitive directories
        const sensitivePatterns = [
            '~/.ssh', '~/.aws', '~/.gnupg', '~/.config/gcloud',
            '~/.kube', '~/.docker', '~/.npmrc', '~/.netrc',
            '.env', 'id_rsa', 'id_ed25519', 'credentials',
            '/etc/shadow', '/etc/passwd',
        ];
        const expandedHome = process.env.HOME || '';
        const normalizedCmd = command.replace(/~/g, expandedHome);
        for (const pattern of sensitivePatterns) {
            const expanded = pattern.replace(/~/g, expandedHome);
            if (normalizedCmd.includes(expanded) || command.includes(pattern)) {
                throw new Error(`Access to sensitive path '${pattern}' is not allowed.`);
            }
        }
        // P0 Fix #5: Block path traversal beyond workspace
        if (command.includes('/../') || command.endsWith('/..')) {
            throw new Error(`Path traversal patterns are not allowed.`);
        }
        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: process.cwd(),
                timeout: 10000,
                maxBuffer: 1024 * 1024 // 1MB output limit
            });
            return { output: stdout || stderr, exitCode: 0 };
        }
        catch (e) {
            return {
                output: e.stdout || e.stderr || e.message,
                exitCode: e.code || 1
            };
        }
    }
    // === EXEC: Executable Skills ===
    async executeSkillScript(skillName, scriptFile, args = {}) {
        const scriptPath = path.join(SKILLS_DIR, skillName, scriptFile);
        // 1. Ensure file exists
        try {
            await fs.access(scriptPath);
        }
        catch {
            return `Error: Script '${scriptFile}' not found.`;
        }
        // 2. Prepare execution
        let cmd = scriptPath;
        if (scriptPath.endsWith('.js')) {
            cmd = `node "${scriptPath}"`;
        }
        else {
            // Try making it executable
            try {
                await fs.chmod(scriptPath, '755');
            }
            catch (e) {
                console.error(`[MiniClaw] Failed to chmod script: ${e}`);
            }
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
        }
        catch (e) {
            return `Skill execution failed: ${e.message}\nOutput: ${e.stdout || e.stderr}`;
        }
    }
    // === SANDBOX VALIDATION ===
    async validateSkillSandbox(skillName, validationCmd) {
        const skillDir = path.join(SKILLS_DIR, skillName);
        try {
            // Run in a restricted environment with a strict timeout
            const { stdout, stderr } = await execAsync(`cd "${skillDir}" && ${validationCmd}`, {
                timeout: 2000, // 2 seconds P0 strict timeout for generated skills
                env: { ...process.env, MINICLAW_SANDBOX: "1" }
            });
            console.error(`[MiniClaw] Sandbox validation passed for ${skillName}. Output: ${stdout.trim().slice(0, 50)}...`);
        }
        catch (e) {
            const errorOutput = e.stdout || e.stderr || e.message;
            throw new Error(`Execution failed with code ${e.code || 1}\nOutput:\n${errorOutput.trim().slice(0, 500)}`);
        }
    }
    // === LIFECYCLE HOOKS ===
    // Skills can declare hooks via metadata.hooks: "onBoot,onHeartbeat,onMemoryWrite"
    // When an event fires, all matching skills with exec scripts are run.
    async runSkillHooks(event, payload = {}) {
        const skills = await this.skillCache.getAll();
        const results = [];
        for (const [name, skill] of skills) {
            const hooks = getSkillMeta(skill.frontmatter, 'hooks');
            if (!hooks)
                continue;
            // Parse hooks: string "onBoot,onHeartbeat" or array ["onBoot","onHeartbeat"]
            const hookList = Array.isArray(hooks) ? hooks : String(hooks).split(',').map(h => h.trim());
            if (!hookList.includes(event))
                continue;
            const execScript = getSkillMeta(skill.frontmatter, 'exec');
            if (typeof execScript === 'string') {
                try {
                    const output = await this.executeSkillScript(name, execScript, { event, ...payload });
                    if (output.trim())
                        results.push(`[${name}] ${output.trim()}`);
                    this.state.analytics.skillUsage[name] = (this.state.analytics.skillUsage[name] || 0) + 1;
                }
                catch (e) {
                    results.push(`[${name}] hook error: ${e.message}`);
                }
            }
        }
        if (results.length > 0)
            await this.saveState();
        return results;
    }
    // === WORKSPACE: Auto-Detection ===
    async detectWorkspace() {
        const cwd = process.cwd();
        const info = {
            name: path.basename(cwd),
            path: cwd,
            git: { isRepo: false, branch: '', status: '', recentCommits: '' },
            techStack: []
        };
        // 1. Tech Stack Detection
        const files = await fs.readdir(cwd).catch(() => []);
        if (files.includes('package.json'))
            info.techStack.push('Node.js');
        if (files.includes('tsconfig.json'))
            info.techStack.push('TypeScript');
        if (files.includes('pyproject.toml') || files.includes('requirements.txt'))
            info.techStack.push('Python');
        if (files.includes('Cargo.toml'))
            info.techStack.push('Rust');
        if (files.includes('go.mod'))
            info.techStack.push('Go');
        if (files.includes('docker-compose.yml'))
            info.techStack.push('Docker');
        // 2. Git Detection
        try {
            const { stdout: branch } = await execAsync('git branch --show-current', { cwd });
            info.git.isRepo = true;
            info.git.branch = branch.trim();
            const { stdout: status } = await execAsync('git status --short', { cwd });
            info.git.status = status.trim() ? 'dirty' : 'clean';
            const { stdout: log } = await execAsync('git log --oneline -3', { cwd });
            info.git.recentCommits = log.trim();
        }
        catch { /* not a git repo */ }
        return info;
    }
    detectContinuation(dailyLog) {
        const result = { isReturn: false, hoursSinceLastActivity: 0, lastTopic: '', recentDecisions: [], openQuestions: [] };
        const la = this.state.analytics.lastActivity;
        if (!la)
            return result;
        const hrs = (Date.now() - new Date(la).getTime()) / 3_600_000;
        if (hrs < 1)
            return result;
        result.isReturn = true;
        result.hoursSinceLastActivity = Math.round(hrs * 10) / 10;
        if (!dailyLog)
            return result;
        const entries = dailyLog.split('\n').filter(l => l.startsWith('- ['));
        const last = entries.at(-1)?.match(/^- \[\d{1,2}:\d{2}(?::\d{2})?\]\s*(.+)/);
        if (last)
            result.lastTopic = last[1].substring(0, 120);
        const clean = (e) => e.replace(/^- \[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '').substring(0, 80);
        for (const e of entries.slice(-10)) {
            if (/decided|选择|确认|agreed|决定|chosen|confirmed/i.test(e))
                result.recentDecisions.push(clean(e));
            if (/\?|TODO|todo|待|问题|question|需要/i.test(e))
                result.openQuestions.push(clean(e));
        }
        return result;
    }
    // === Self-Evolution: File Health Check ===
    async checkFileHealth() {
        const warnings = [];
        const now = Date.now();
        const files = ["MEMORY.md", "USER.md", "SOUL.md"];
        const results = await Promise.all(files.map(async (name) => {
            try {
                const stat = await fs.stat(path.join(MINICLAW_DIR, name));
                const daysSince = Math.round((now - stat.mtimeMs) / (1000 * 60 * 60 * 24));
                return { name, days: daysSince };
            }
            catch {
                return null;
            }
        }));
        for (const r of results) {
            if (!r)
                continue;
            if (r.days > 30)
                warnings.push(`🔴 ${r.name}: ${r.days}d stale`);
            else if (r.days > 14)
                warnings.push(`⚠️ ${r.name}: ${r.days}d old`);
        }
        return warnings;
    }
    async generateBriefing() {
        await this.loadState();
        const todayStr = today();
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        let b = `## 🌅 Daily Briefing — ${todayStr}\n\n`;
        const yLog = await safeRead(path.join(MEMORY_DIR, `${yesterday}.md`));
        if (yLog) {
            const entries = yLog.split('\n').filter(l => l.startsWith('- ['));
            b += `### 📋 Yesterday (${entries.length} entries)\n${entries.slice(-5).join('\n')}\n\n`;
            const questions = yLog.split('\n').filter(l => /\?|TODO|todo|待|需要/.test(l)).slice(-3);
            if (questions.length > 0)
                b += `### ❓ Unresolved\n${questions.join('\n')}\n\n`;
        }
        const a = this.state.analytics;
        const topTools = Object.entries(a.toolCalls).sort(([, x], [, y]) => y - x).slice(0, 3);
        if (topTools.length > 0)
            b += `### 📊 Stats\n- Boots: ${a.bootCount} | Avg: ${a.bootCount > 0 ? Math.round(a.totalBootMs / a.bootCount) : 0}ms\n- Top: ${topTools.map(([n, c]) => `${n}(${c})`).join(', ')}\n\n`;
        const skills = await this.skillCache.getAll();
        const unused = Array.from(skills.keys()).filter(n => !a.skillUsage[n]);
        if (unused.length > 0)
            b += `### 💡 Unused skills: ${unused.join(', ')}\n\n`;
        const entities = await this.entityStore.list();
        if (entities.length > 0) {
            const top = entities.sort((a, b) => b.lastMentioned.localeCompare(a.lastMentioned)).slice(0, 5);
            b += `### 🕸️ Top Entities\n${top.map(e => `- **${e.name}** (${e.type}, ${e.mentionCount}x)`).join('\n')}\n`;
        }
        const warnings = await this.checkFileHealth();
        if (warnings.length > 0)
            b += `\n### 🏥 Health\n${warnings.map(w => `- ${w}`).join('\n')}\n`;
        return b;
    }
    // === Budget Compiler ===
    compileBudget(sections, budgetTokens) {
        // Sort by Priority + Attention Weight
        const sorted = [...sections].sort((a, b) => {
            const weightA = this.state.attentionWeights[a.name] || 0;
            const weightB = this.state.attentionWeights[b.name] || 0;
            return (b.priority + weightB) - (a.priority + weightA);
        });
        const maxChars = budgetTokens * this.charsPerToken;
        let output = "";
        let totalChars = 0;
        const truncatedSections = [];
        for (const section of sorted) {
            const sectionChars = section.content.length;
            if (totalChars + sectionChars <= maxChars) {
                output += section.content;
                totalChars += sectionChars;
            }
            else {
                const remaining = maxChars - totalChars;
                if (remaining > SKELETON_THRESHOLD) {
                    const skeleton = this.skeletonizeMarkdown(section.name, section.content, remaining);
                    output += skeleton;
                    totalChars += skeleton.length;
                    truncatedSections.push(section.name);
                }
                else if (remaining > 100) {
                    // Very small slice: just the footer
                    const footer = `\n\n... [${section.name}: truncated, budget tight]\n`;
                    output += footer;
                    totalChars += footer.length;
                    truncatedSections.push(section.name);
                }
                else {
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
    skeletonizeMarkdown(name, content, budgetChars) {
        if (content.length <= budgetChars)
            return content;
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
        }
        else {
            skeleton += footer;
        }
        return skeleton;
    }
    // === Genetic Proofreading (L-Immun) ===
    async calculateGenomeHash() {
        const hashes = {};
        const germlineDNA = ["IDENTITY.md", "SOUL.md", "AGENTS.md"];
        for (const name of germlineDNA) {
            try {
                const content = await fs.readFile(path.join(MINICLAW_DIR, name), "utf-8");
                hashes[name] = hashString(content);
            }
            catch { /* ignore missing germline files */ }
        }
        return hashes;
    }
    proofreadGenome(current, baseline) {
        const deviations = [];
        for (const [name, hash] of Object.entries(baseline)) {
            if (!(name in current)) {
                deviations.push(`Missing: ${name}`);
            }
            else if (current[name] !== hash) {
                deviations.push(`Mutated: ${name}`);
            }
        }
        return deviations;
    }
    async updateGenomeBaseline() {
        const backupDir = path.join(MINICLAW_DIR, ".backup", "genome");
        await fs.mkdir(backupDir, { recursive: true });
        const current = await this.calculateGenomeHash();
        this.state.genomeBaseline = current;
        for (const name of Object.keys(current)) {
            try {
                const content = await fs.readFile(path.join(MINICLAW_DIR, name), "utf-8");
                await atomicWrite(path.join(backupDir, name), content);
            }
            catch { /* skip missing */ }
        }
        await this.saveState();
        console.error(`[MiniClaw] Genome baseline updated and backed up for: ${Object.keys(current).join(', ')}`);
    }
    async restoreGenome() {
        const baseline = this.state.genomeBaseline || {};
        const current = await this.calculateGenomeHash();
        const deviations = this.proofreadGenome(current, baseline);
        const backupDir = path.join(MINICLAW_DIR, ".backup", "genome");
        const restored = [];
        for (const dev of deviations) {
            const fileName = dev.split(': ')[1];
            if (!fileName)
                continue;
            try {
                const backupPath = path.join(backupDir, fileName);
                const content = await fs.readFile(backupPath, "utf-8");
                await atomicWrite(path.join(MINICLAW_DIR, fileName), content);
                restored.push(fileName);
            }
            catch { /* backup missing or restore failed */ }
        }
        return restored;
    }
    // === Delta Detection ===
    computeDelta(currentHashes, previousHashes) {
        const changed = [];
        const unchanged = [];
        const newSections = [];
        for (const [name, hash] of Object.entries(currentHashes)) {
            if (!(name in previousHashes)) {
                newSections.push(name);
            }
            else if (previousHashes[name] !== hash) {
                changed.push(name);
            }
            else {
                unchanged.push(name);
            }
        }
        return { changed, unchanged, newSections };
    }
    // === Helpers ===
    senseRuntime() {
        const gitBranch = (() => {
            try {
                return require('child_process').execSync('git branch --show-current', { cwd: process.cwd(), stdio: 'pipe' }).toString().trim();
            }
            catch {
                return '';
            }
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
    async loadEpigenetics(workspaceInfo) {
        if (!workspaceInfo)
            return null;
        try {
            const epigeneticPath = path.join(workspaceInfo.path, ".miniclaw", "EPIGENETICS.md");
            return await fs.readFile(epigeneticPath, "utf-8");
        }
        catch {
            return null;
        }
    }
    async scanMemory() {
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
                }
                catch { /* ignore */ }
            }
        }
        return { todayFile, todayContent, archivedCount, entryCount, oldestEntryAge };
    }
    async loadTemplates() {
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
                            }
                            catch {
                                continue;
                            }
                        }
                    }
                    catch { /* recovery failed, use what we have */ }
                }
                return content;
            }
            catch (e) {
                if (name !== "BOOTSTRAP.md" && name !== "SUBAGENT.md" && name !== "HEARTBEAT.md") {
                    this.bootErrors.push(`${name}: ${e.message?.split('\n')[0] || 'read failed'}`);
                }
                return "";
            }
        }));
        // ★ Dynamic File Discovery: scan for extra .md files with boot-priority
        const dynamicFiles = [];
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
                }
                catch { /* skip unreadable files */ }
            }
            // Sort by priority descending (highest loaded first)
            dynamicFiles.sort((a, b) => b.priority - a.priority);
        }
        catch { /* directory scan failed, not critical */ }
        return {
            agents: results[0], soul: results[1], identity: results[2],
            user: results[3], horizons: results[4], concepts: results[5], tools: results[6], memory: results[7],
            heartbeat: results[8], bootstrap: results[9], subagent: results[10],
            reflection: results[11],
            dynamicFiles,
        };
    }
    formatFile(name, content) {
        if (!content)
            return "";
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
    async copyDirRecursive(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                await this.copyDirRecursive(srcPath, destPath);
            }
            else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }
    async syncBuiltInSkills() {
        if (!(await fileExists(INTERNAL_SKILLS_DIR)))
            return;
        try {
            const dirs = (await fs.readdir(INTERNAL_SKILLS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
            for (const dir of dirs) {
                const target = path.join(SKILLS_DIR, dir.name);
                if (!(await fileExists(target))) {
                    await this.copyDirRecursive(path.join(INTERNAL_SKILLS_DIR, dir.name), target);
                }
            }
        }
        catch (e) {
            this.bootErrors.push(`🔧 Skill sync failed: ${e.message}`);
        }
    }
    async syncBuiltInTemplates() {
        if (!(await fileExists(INTERNAL_TEMPLATES_DIR)))
            return;
        try {
            const files = (await fs.readdir(INTERNAL_TEMPLATES_DIR, { withFileTypes: true }))
                .filter(e => e.isFile() && e.name.endsWith('.md'));
            for (const file of files) {
                const target = path.join(MINICLAW_DIR, file.name);
                if (!(await fileExists(target))) {
                    await fs.copyFile(path.join(INTERNAL_TEMPLATES_DIR, file.name), target);
                }
            }
        }
        catch (e) {
            this.bootErrors.push(`🔧 Template sync failed: ${e.message}`);
        }
    }
    async ensureDirs() {
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
    async discoverSkillResources() {
        const allResources = [];
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
    async discoverSkillTools() {
        const allTools = [];
        const skills = await this.skillCache.getAll();
        for (const [, skill] of skills) {
            allTools.push(...this.parseSkillToolEntries(skill.frontmatter, skill.name));
        }
        return allTools;
    }
    async getSkillContent(skillName, fileName = "SKILL.md") {
        if (fileName === "SKILL.md") {
            const skills = await this.skillCache.getAll();
            const skill = skills.get(skillName);
            return skill?.content || "";
        }
        try {
            return await fs.readFile(path.join(SKILLS_DIR, skillName, fileName), "utf-8");
        }
        catch {
            return "";
        }
    }
    async getSkillCount() {
        const skills = await this.skillCache.getAll();
        return skills.size;
    }
    // === Smart Distillation Evaluation ===
    async evaluateDistillation(dailyLogBytes) {
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
    async emitPulse() {
        try {
            await fs.mkdir(PULSE_DIR, { recursive: true });
            const pulseFile = path.join(PULSE_DIR, 'sovereign-alpha.json'); // Default internal ID for now
            const pulseData = {
                id: 'sovereign-alpha',
                timestamp: new Date().toISOString(),
                vitals: 'active'
            };
            await fs.writeFile(pulseFile, JSON.stringify(pulseData, null, 2), 'utf-8');
        }
        catch (e) {
            this.bootErrors.push(`💓 Pulse failed: ${e.message}`);
        }
    }
    // === Write to HEARTBEAT.md for user visibility
    async writeToHeartbeat(content) {
        try {
            const hbFile = path.join(MINICLAW_DIR, "HEARTBEAT.md");
            await fs.appendFile(hbFile, content, "utf-8");
        }
        catch (e) {
            console.error(`[MiniClaw] Failed to write to HEARTBEAT.md: ${e}`);
        }
    }
    // === Private Parsers ===
    parseSkillToolEntries(frontmatter, skillName) {
        const tools = [];
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
                }
                else if (typeof item === 'object' && item !== null) {
                    const vItem = item;
                    const rawName = vItem.name;
                    // For executable sub-tools, format as skill_xxx_yyy
                    const toolName = rawName ? `skill_${skillName}_${rawName}` : '';
                    if (toolName) {
                        const desc = vItem.description || `Skill tool: ${skillName}`;
                        const execCmd = vItem.exec || defaultExecScript;
                        const toolDecl = {
                            skillName,
                            toolName,
                            description: desc,
                            exec: execCmd
                        };
                        if (vItem.schema) {
                            toolDecl.schema = vItem.schema;
                        }
                        tools.push(toolDecl);
                    }
                }
            }
        }
        else if (defaultExecScript) {
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
