import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, atomicWrite, nowIso, today, safeRead, safeWrite, hoursSince, fileExists } from "./utils.js";
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
    active: { emoji: "⚡", label: "Active", briefing: true, reflective: false, minimal: false },
    evening: { emoji: "🌙", label: "Evening", briefing: false, reflective: true, minimal: false },
    rest: { emoji: "💤", label: "Rest", briefing: false, reflective: false, minimal: true },
};
const DEFAULT_HEARTBEAT = {
    lastHeartbeat: null,
    lastDistill: null,
    needsDistill: false,
    dailyLogBytes: 0,
    needsSubconsciousReflex: false,
};
// === Skill Cache (Solves N+1 problem) ===
// --- Skill Logic ---
class SkillCache {
    cache = new Map();
    async getAll() {
        if (this.cache.size)
            return this.cache;
        try {
            const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
            for (const dir of entries.filter(e => e.isDirectory())) {
                const sdir = path.join(SKILLS_DIR, dir.name);
                const [c, files, refs] = await Promise.all([
                    fs.readFile(path.join(sdir, "SKILL.md"), "utf-8").catch(() => ""),
                    fs.readdir(sdir).catch(() => []),
                    fs.readdir(path.join(sdir, "references")).catch(() => []),
                ]);
                const fm = parseFrontmatter(c);
                this.cache.set(dir.name, {
                    name: dir.name, content: c, frontmatter: fm,
                    description: fm.description || c.split('\n').find(l => l.trim() && !l.startsWith('#'))?.slice(0, 100) || "",
                    files: files.filter(f => f.endsWith('.md')),
                    referenceFiles: refs.filter(f => f.endsWith('.md'))
                });
            }
        }
        catch { }
        return this.cache;
    }
    invalidate() { this.cache.clear(); }
}
// (Autonomic methods moved into ContextKernel)
// === Entity Store ===
class EntityStore {
    entities = [];
    loaded = false;
    invalidate() { this.loaded = false; this.entities = []; }
    async load() {
        if (this.loaded)
            return;
        try {
            this.entities = JSON.parse(await fs.readFile(ENTITIES_FILE, "utf-8")).entities || [];
        }
        catch { }
        this.loaded = true;
    }
    async save() { await atomicWrite(ENTITIES_FILE, JSON.stringify({ entities: this.entities }, null, 2)); }
    async add(entity) {
        await this.load();
        const now = today();
        const e = this.entities.find(x => x.name.toLowerCase() === entity.name.toLowerCase());
        if (e) {
            e.lastMentioned = now;
            e.mentionCount++;
            Object.assign(e.attributes, entity.attributes);
            for (const r of entity.relations)
                if (!e.relations.includes(r))
                    e.relations.push(r);
            e.closeness = Math.min(1, Math.round(((e.closeness || 0) * 0.95 + 0.1) * 100) / 100);
            if (entity.sentiment)
                e.sentiment = entity.sentiment;
        }
        else {
            if (this.entities.length >= 1000)
                this.entities.shift();
            this.entities.push({ ...entity, firstMentioned: now, lastMentioned: now, mentionCount: 1, closeness: 0.1 });
        }
        await this.save();
        return e || this.entities[this.entities.length - 1];
    }
    async remove(n) { await this.load(); const i = this.entities.findIndex(x => x.name.toLowerCase() === n.toLowerCase()); if (i < 0)
        return false; this.entities.splice(i, 1); await this.save(); return true; }
    async updateSentiment(n, s) { await this.load(); const e = this.entities.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!e)
        return false; e.sentiment = s; await this.save(); return true; }
    async link(n, r) { await this.load(); const e = this.entities.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!e)
        return false; if (!e.relations.includes(r)) {
        e.relations.push(r);
        e.lastMentioned = today();
        await this.save();
    } return true; }
    async query(n) { await this.load(); return this.entities.find(x => x.name.toLowerCase() === n.toLowerCase()) || null; }
    async list(t) { await this.load(); return t ? this.entities.filter(x => x.type === t) : [...this.entities]; }
    async getCount() { await this.load(); return this.entities.length; }
    async surfaceRelevant(text) {
        await this.load();
        const l = text.toLowerCase();
        return this.entities.filter(e => l.includes(e.name.toLowerCase())).sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 5);
    }
}
function getTimeMode(hour) {
    if (hour >= 8 && hour < 18)
        return "active";
    if (hour >= 18 && hour < 22)
        return "evening";
    return "rest";
}
export class ContextKernel {
    skillCache = new SkillCache();
    entityStore = new EntityStore();
    autonomicTimers = new Map();
    state = {
        analytics: {
            toolCalls: {}, bootCount: 0,
            totalBootMs: 0, lastActivity: "", skillUsage: {},
            dailyDistillations: 0,
            activeHours: new Array(24).fill(0), fileChanges: {},
        },
        previousHashes: {},
        heartbeat: { ...DEFAULT_HEARTBEAT },
        attentionWeights: {},
    };
    stateLoaded = false;
    budgetTokens;
    charsPerToken;
    constructor(options = {}) {
        this.budgetTokens = options.budgetTokens || parseInt(process.env.MINICLAW_TOKEN_BUDGET || "8000", 10);
        this.charsPerToken = options.charsPerToken || 3.6;
        console.error(`[MiniClaw] Kernel initialized`);
    }
    startAutonomic() {
        this.autonomicTimers.set('pulse', setInterval(() => this.pulse(), 5 * 60 * 1000));
        this.autonomicTimers.set('dream', setInterval(() => this.checkDream(), 60 * 1000));
    }
    async pulse() {
        const pulseDir = path.join(MINICLAW_DIR, 'pulse');
        await fs.mkdir(pulseDir, { recursive: true });
        const myId = process.env.MINICLAW_ID || 'sovereign';
        await safeWrite(path.join(pulseDir, `${myId}.json`), JSON.stringify({ id: myId, timestamp: nowIso() }));
    }
    async checkDream() {
        const a = await this.getAnalytics();
        if (hoursSince(a.lastActivity || 0) >= 4) {
            await analyzePatterns(MINICLAW_DIR);
            await runEvolution(MINICLAW_DIR);
        }
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
            }
            if (data.previousHashes)
                this.state.previousHashes = data.previousHashes;
            if (data.heartbeat)
                this.state.heartbeat = { ...DEFAULT_HEARTBEAT, ...data.heartbeat };
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
    async mutateState(f) {
        await this.loadState();
        const r = f(this.state);
        await this.saveState();
        return r;
    }
    async trackTool(n, e) {
        return this.mutateState(s => {
            s.analytics.toolCalls[n] = (s.analytics.toolCalls[n] || 0) + 1;
            const h = new Date().getHours();
            s.analytics.activeHours[h] = (s.analytics.activeHours[h] || 0) + 1;
            const b = (t) => s.attentionWeights[t] = Math.min(1, (s.attentionWeights[t] || 0) + 0.1);
            if (n.startsWith('skill_'))
                b(`skill:${n.split('_')[1]}`);
            b(n);
            s.analytics.lastActivity = nowIso();
        });
    }
    async getAnalytics() { await this.loadState(); return this.state.analytics; }
    async getHeartbeatState() { await this.loadState(); return this.state.heartbeat; }
    async updateHeartbeatState(u) { return this.mutateState(s => Object.assign(s.heartbeat, u)); }
    decayAttention() { for (const k in this.state.attentionWeights)
        (this.state.attentionWeights[k] *= 0.95) < 0.01 && delete this.state.attentionWeights[k]; }
    async trackFileChange(f) { return this.mutateState(s => { s.analytics.fileChanges[f] = (s.analytics.fileChanges[f] || 0) + 1; }); }
    // ★ Growth Drive: Removed (SOTA Lightweighting)
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
        const bootStart = Date.now();
        await Promise.all([this.ensureDirs(), this.loadState(), this.entityStore.load()]);
        this.decayAttention();
        await this.saveState();
        const [skills, mem, tmpl, ws] = await Promise.all([
            this.skillCache.getAll(), this.scanMemory(), this.loadTemplates(),
            this.detectWorkspace()
        ]);
        const epigenetics = await this.loadEpigenetics(ws);
        const continuation = this.detectContinuation(mem.todayContent);
        const surfaced = mem.todayContent ? await this.entityStore.surfaceRelevant(mem.todayContent) : [];
        const sections = [];
        const add = (n, c, p) => c && sections.push({ name: n, content: c, priority: p });
        const now = new Date();
        const tm = TIME_MODES[getTimeMode(now.getHours())];
        const providers = [
            () => add("core", "You are MiniClaw 0.7. Narrative brief, safety first.", 10),
            () => add("IDENTITY.md", tmpl.identity ? this.formatFile("IDENTITY.md", tmpl.identity) : undefined, 10),
            () => add("NOCICEPTION.md", tmpl.nociception ? `## 🚨 Avoidance Patterns (Taboos)\n${tmpl.nociception}` : undefined, 9),
            () => add("EPIGENETICS", epigenetics ? `## Project Overrides\n${epigenetics}` : undefined, 9),
            () => {
                let ace = `## ACE: ${tm.emoji} ${tm.label} (${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')})\n`;
                if (continuation.isReturn)
                    ace += `Continuation: ${continuation.lastTopic}\n`;
                add("ace", ace, 10);
            },
            ...["SOUL", "AGENTS", "USER", "HORIZONS"].map(k => () => {
                const key = k.toLowerCase();
                add(`${k}.md`, tmpl[key] ? this.formatFile(`${k}.md`, tmpl[key]) : undefined, 9);
            }),
            () => ws && add("workspace", `## Workspace: ${ws.name}\nGit: ${ws.git.branch}${ws.recentFiles?.length ? `\nRecent files: ${ws.recentFiles.join(', ')}` : ''}`, 6),
            () => add("MEMORY.md", tmpl.memory ? `## Memory\n${this.formatFile("MEMORY.md", tmpl.memory)}` : undefined, 7),
            () => {
                const ss = Array.from(skills.entries());
                if (!ss.length)
                    return;
                const us = this.state.analytics.skillUsage;
                const lines = ss.sort((a, b) => (us[b[0]] || 0) - (us[a[0]] || 0)).map(([n, s]) => (`- ${n}: ${s.description}`));
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
        }
        catch { /* macOS only, fail silently */ }
        // macOS: Focus Mode (Do Not Disturb) & Active IDE detection
        try {
            const [{ stdout: dnd }, { stdout: apps }] = await Promise.all([
                execAsync('defaults read com.apple.controlcenter "NSStatusItem Visible DoNotDisturb" 2>/dev/null', { timeout: 500 }).catch(() => ({ stdout: '0' })),
                execAsync('lsappinfo list 2>/dev/null', { timeout: 500 }).catch(() => ({ stdout: '' }))
            ]);
            const isDND = dnd.trim() === '1';
            const runningApps = apps.split('\n')
                .filter(l => l.includes('ASN:'))
                .map(l => l.match(/"([^"]+)"/)?.[1])
                .filter(Boolean);
            const activeIDEs = runningApps.filter(a => /cursor|code|windsurf|webstorm|idea|zed|xcode/i.test(a));
            if (isDND || activeIDEs.length > 0) {
                let msg = `## User State\n`;
                if (isDND)
                    msg += `🔕 Do Not Disturb: ON (Keep responses brief, avoid non-critical notifications)\n`;
                if (activeIDEs.length > 0)
                    msg += `💻 Active IDEs: ${activeIDEs.join(', ')}\n`;
                add("user_focus", msg, 8);
            }
        }
        catch { /* ignore */ }
        providers.forEach(p => p());
        const compiled = this.compileBudget(sections, this.budgetTokens);
        this.state.analytics.bootCount++;
        this.state.analytics.totalBootMs += (Date.now() - bootStart);
        this.state.analytics.lastActivity = now.toISOString();
        await this.saveState();
        return `# Context\n\n${compiled.output}\n---\nUtil: ${compiled.utilizationPct}% | boot #${this.state.analytics.bootCount}\n`;
    }
    // === EXEC: Safe Command Execution ===
    async execCommand(command) {
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
        }
        catch (e) {
            return { output: e.stdout || e.stderr || e.message, exitCode: e.code || 1 };
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
        // 3. Recent Files via mdfind (macOS Spotlight)
        try {
            const { stdout: recentFiles } = await execAsync(`mdfind -onlyin "${cwd}" "kMDItemFSContentChangeDate > $time.now(-3600)" 2>/dev/null | head -5`, { timeout: 2000 });
            const files = recentFiles.trim().split('\n').filter(Boolean).map(f => path.basename(f));
            if (files.length > 0)
                info.recentFiles = files;
        }
        catch { /* mdfind unavailable or no results */ }
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
                }
                catch { /* ignore */ }
            }
        }
        return { todayFile, todayContent, archivedCount, entryCount, oldestEntryAge };
    }
    async loadInstincts() {
        const p = path.join(MINICLAW_DIR, "RIBOSOME.json");
        try {
            return JSON.parse(await fs.readFile(p, "utf-8")).instincts;
        }
        catch {
            return {};
        }
    }
    async loadTemplates() {
        const names = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "HORIZONS.md", "CONCEPTS.md", "TOOLS.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md", "REFLECTION.md", "NOCICEPTION.md"];
        const results = await Promise.all(names.map(name => safeRead(path.join(MINICLAW_DIR, name))));
        const dynamicFiles = [];
        try {
            const entries = await fs.readdir(MINICLAW_DIR, { withFileTypes: true });
            for (const entry of entries.filter(e => e.isFile() && e.name.endsWith('.md') && !names.includes(e.name))) {
                const content = await safeRead(path.join(MINICLAW_DIR, entry.name));
                const bpMatch = content.match(/boot-priority:\s*(\d+)/);
                if (bpMatch)
                    dynamicFiles.push({ name: entry.name, content, priority: parseInt(bpMatch[1]) });
            }
            dynamicFiles.sort((a, b) => b.priority - a.priority);
        }
        catch { }
        return {
            agents: results[0], soul: results[1], identity: results[2],
            user: results[3], horizons: results[4], concepts: results[5], tools: results[6], memory: results[7],
            heartbeat: results[8], bootstrap: results[9], reflection: results[10], nociception: results[11],
            dynamicFiles
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
            console.error(`🔧 Skill sync failed: ${e.message}`);
        }
    }
    async syncBuiltInTemplates() {
        if (!(await fileExists(INTERNAL_TEMPLATES_DIR)))
            return;
        try {
            const files = (await fs.readdir(INTERNAL_TEMPLATES_DIR, { withFileTypes: true }))
                .filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.json')));
            for (const file of files) {
                const target = path.join(MINICLAW_DIR, file.name);
                if (!(await fileExists(target))) {
                    await fs.copyFile(path.join(INTERNAL_TEMPLATES_DIR, file.name), target);
                }
            }
        }
        catch (e) {
            console.error(`🔧 Template sync failed: ${e.message}`);
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
            console.error(`💓 Pulse failed: ${e.message}`);
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
