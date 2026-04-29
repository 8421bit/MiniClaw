/**
 * evolution.ts
 * DNA Evolution Engine - Core mechanism for implicit learning
 * 
 * This is a CORE module (not a skill), responsible for:
 * - Pattern detection from memory files
 * - DNA updates with intelligent merging
 * - Milestone tracking and concept extraction
 */

import fs from "node:fs/promises";
import path from "node:path";
import { today, nowIso, safeRead, safeWrite, safeAppend, safeReadJson, hoursSince, calculateSimilarity, atomicWrite } from "./utils.js";

interface Pattern {
    type: string;
    confidence: number;
    description: string;
    suggestion?: string;
    mergedCount?: number;
    avgConfidence?: number;
}

interface Mutation {
    target: string;
    change: string;
    confidence?: number;
}

interface EvolutionState {
    lastEvolution: string | null;
    totalEvolutions: number;
    milestones?: string[];
}

interface EvolutionResult {
    evolved: boolean;
    message: string;
    patterns?: Pattern[];
    appliedMutations?: Mutation[];
    totalEvolutions?: number;
}

function mergeSimilarPatterns(patterns: Pattern[]): Pattern {
    if (patterns.length === 1) return patterns[0];
    const allTerms = patterns.map(p => p.description.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const common = allTerms[0].filter(t => allTerms.every(ts => ts.includes(t)));
    return {
        type: patterns[0].type,
        confidence: Math.max(...patterns.map(p => p.confidence)),
        description: common.length > 0
            ? `${patterns[0].description.split(':')[0]}: ${common.join(', ')} (merged from ${patterns.length})`
            : `${patterns[0].description} (and ${patterns.length - 1} similar)`,
        suggestion: patterns[0].suggestion,
        mergedCount: patterns.length,
        avgConfidence: patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length
    };
}


// === Configuration ===
const MIN_CONFIDENCE = 0.75;
const MIN_PATTERNS = 2;
const COOLDOWN_HOURS = 24;

// === DNA Update Functions ===

/** Generic file append with deduplication */
async function appendIfNew(filePath: string, line: string, dedupeKey: string): Promise<boolean> {
    const content = await safeRead(filePath);
    if (content.includes(dedupeKey)) return false;
    return safeWrite(filePath, content + `\n${line}`).then(() => true);
}


async function smartUpdateDNA(miniclawDir: string, targetFile: string, pattern: Pattern, appliedMutations: Mutation[]): Promise<void> {
    const filePath = path.join(miniclawDir, targetFile);
    const content = await safeRead(filePath);
    if (!content) return;

    const keyConcept = pattern.description.substring(0, 50).replace(/\s+/g, ' ').trim();
    const existingLines = content.split('\n');
    let similarLineIndex = -1;
    let existingConfidence = 0;

    for (let i = 0; i < existingLines.length; i++) {
        const line = existingLines[i];
        if (line.includes('[AUTO-EVOLVED]')) {
            const similarity = calculateSimilarity(line, keyConcept);
            if (similarity > 0.6) {
                similarLineIndex = i;
                const confidenceMatch = line.match(/confidence:\s*([\d.]+)/);
                if (confidenceMatch) existingConfidence = parseFloat(confidenceMatch[1]);
                break;
            }
        }
    }

    const timestamp = today();
    const newConfidence = Math.round((pattern.confidence || 0.7) * 100);
    const detectionCount = pattern.mergedCount || 1;
    const newLine = `- [AUTO-EVOLVED] ${pattern.description} (confidence: ${newConfidence}%, detections: ${detectionCount}, ${similarLineIndex >= 0 ? 'updated' : 'first'}: ${timestamp})`;

    if (similarLineIndex >= 0) {
        if (newConfidence <= existingConfidence) return;
        existingLines[similarLineIndex] = newLine;
        await safeWrite(filePath, existingLines.join('\n'));
        appliedMutations.push({ target: targetFile, change: `Updated: ${pattern.description}`, confidence: newConfidence });
    } else {
        await safeWrite(filePath, content + `\n${newLine}`);
        appliedMutations.push({ target: targetFile, change: pattern.description, confidence: newConfidence });
    }
}

async function updateReflection(miniclawDir: string, type: string, desc: string, muts: Mutation[]): Promise<void> {
    const line = `- [AUTO-EVOLVED] ${type}: ${desc} (reflected: ${today()})`;
    if (await appendIfNew(path.join(miniclawDir, "REFLECTION.md"), line, desc.substring(0, 40))) {
        muts.push({ target: "REFLECTION.md", change: `${type}: ${desc}` });
    }
}

async function extractConcepts(miniclawDir: string, pattern: Pattern, muts: Mutation[]): Promise<void> {
    const matches = pattern.description.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g) || [];
    for (const c of matches.slice(0, 3)) {
        if (c.length > 3 && await appendIfNew(path.join(miniclawDir, "CONCEPTS.md"), `- **${c}**: [AUTO-EVOLVED] Concept.`, c)) {
            muts.push({ target: "CONCEPTS.md", change: `Added concept: ${c}` });
        }
    }
}

async function checkMilestones(miniclawDir: string, state: EvolutionState, muts: Mutation[]): Promise<void> {
    for (const m of [1, 5, 10]) {
        if (state.totalEvolutions === m) {
            const desc = `${m === 1 ? 'First' : m + 'th Gen'} Evolution`;
            if (await appendIfNew(path.join(miniclawDir, "HORIZONS.md"), `- [AUTO-EVOLVED] Milestone: ${desc} (${today()})`, desc)) {
                muts.push({ target: "HORIZONS.md", change: `Milestone: ${desc}` });
            }
        }
    }
}

// === Pattern Detection ===

function detectWorkflowPatterns(content: string): { name: string; steps: string[]; frequency: number }[] {
    const workflows: { name: string; steps: string[]; frequency: number }[] = [];
    const toolSequence = [...content.matchAll(/miniclaw_(\w+)/g)].map(m => m[0]);

    if (toolSequence.length >= 6) {
        for (let len = 2; len <= 3; len++) {
            const sequences: Record<string, number> = {};
            for (let i = 0; i <= toolSequence.length - len; i++) {
                const seq = toolSequence.slice(i, i + len).join(" → ");
                sequences[seq] = (sequences[seq] || 0) + 1;
            }
            const repeated = Object.entries(sequences).filter(([, count]) => count >= 2);
            if (repeated.length > 0) {
                const [topSeq, count] = repeated.sort((a, b) => b[1] - a[1])[0];
                workflows.push({ name: `Repeated ${len}-step workflow`, steps: topSeq.split(" → "), frequency: count });
            }
        }
    }
    return workflows;
}

export async function analyzePatterns(miniclawDir: string): Promise<Pattern[]> {
    const memoryDir = path.join(miniclawDir, 'memory');
    const patterns: Pattern[] = [];
    const files = await fs.readdir(memoryDir).catch(() => [] as string[]);
    const mdFiles = files.filter(f => f.endsWith('.md') && !f.includes('archived')).sort().slice(-7);
    if (mdFiles.length === 0) return patterns;

    const combined = (await Promise.all(mdFiles.map(f => fs.readFile(path.join(memoryDir, f), 'utf-8')))).join('\n');
    const add = (type: string, confidence: number, desc: string, suggestion?: string) =>
        patterns.push({ type, confidence, description: desc, suggestion });

    // Question patterns
    const questions = [...combined.matchAll(/用户问|问|how to|怎么/gi)];
    if (questions.length > 5) add('repetition', Math.min(0.9, questions.length / 10), `${questions.length} question patterns`, 'Consider creating skills for FAQs');

    // Tool usage
    const toolCounts: Record<string, number> = {};
    for (const m of combined.matchAll(/miniclaw_[a-z_]+/g)) toolCounts[m[0]] = (toolCounts[m[0]] || 0) + 1;
    const freq = Object.entries(toolCounts).filter(([, c]) => c > 3);
    if (freq.length > 0) add('preference', 0.8, `Frequent tools: ${freq.map(([t]) => t).join(', ')}`);

    // Temporal
    const ts = [...combined.matchAll(/\[(\d{2}):(\d{2})/g)];
    if (ts.length > 5) {
        const hc: Record<number, number> = {};
        for (const m of ts) hc[parseInt(m[1])] = (hc[parseInt(m[1])] || 0) + 1;
        const peak = Object.entries(hc).sort((a, b) => +b[1] - +a[1])[0];
        if (peak && +peak[1] > 3) add('temporal', 0.75, `Peak activity at ${peak[0]}:00`);
    }

    // Workflow
    const wf = detectWorkflowPatterns(combined);
    if (wf.length > 0) add('workflow', 0.7, `Workflow: ${wf[0].name}`);

    // Sentiment
    const pos = [...combined.matchAll(/(谢谢|感谢|很好|不错|perfect|great)/gi)].length;
    const neg = [...combined.matchAll(/(不对|错了|糟糕|wrong|bad)/gi)].length;
    if (pos > 3 || neg > 3) add('sentiment', 0.65, `Feedback: ${pos > neg ? 'positive' : 'negative'}`);

    // Errors
    const errors = [...combined.matchAll(/(error|failed|exception|crash)/gi)].length;
    if (errors > 3) add('error_pattern', 0.7, `${errors} errors detected`);

    await safeWrite(path.join(miniclawDir, 'observer-patterns.json'), JSON.stringify({ timestamp: nowIso(), patterns }, null, 2));
    return patterns;
}

// === Evolution Trigger ===

export async function triggerEvolution(miniclawDir: string): Promise<EvolutionResult> {
    const stateFile = path.join(miniclawDir, "observer-state.json");
    let state: EvolutionState = { lastEvolution: null, totalEvolutions: 0 };

    state = await safeReadJson(stateFile, state);

    // Check cooldown
    if (state.lastEvolution && hoursSince(state.lastEvolution) < COOLDOWN_HOURS) {
        const remaining = Math.round(COOLDOWN_HOURS - hoursSince(state.lastEvolution));
        return { evolved: false, message: `Cooldown active. ${remaining} hours remaining.` };
    }

    // Load patterns
    const patternsFile = path.join(miniclawDir, "observer-patterns.json");
    let patterns: Pattern[] = [];
    try {
        const data = JSON.parse(await fs.readFile(patternsFile, "utf-8"));
        patterns = data.patterns || [];
    } catch {
        return { evolved: false, message: "No patterns to evolve from" };
    }

    // Filter strong patterns
    const strongPatterns = patterns.filter(p => p.confidence >= MIN_CONFIDENCE);
    if (strongPatterns.length < MIN_PATTERNS) {
        return { evolved: false, message: `Insufficient strong patterns (${strongPatterns.length}/${MIN_PATTERNS})` };
    }

    // Apply evolution
    const appliedMutations: Mutation[] = [];
    const patternsByType: Record<string, Pattern[]> = {};
    for (const p of strongPatterns) {
        if (!patternsByType[p.type]) patternsByType[p.type] = [];
        patternsByType[p.type].push(p);
    }

    for (const [type, typePatterns] of Object.entries(patternsByType)) {
        const merged = mergeSimilarPatterns(typePatterns);

        if (type === "preference" || type === "sentiment") {
            await smartUpdateDNA(miniclawDir, "SOUL.md", merged, appliedMutations);
            if (type === "sentiment") await updateReflection(miniclawDir, "emotional_adaptation", merged.description, appliedMutations);
        } else if (type === "temporal") {
            await smartUpdateDNA(miniclawDir, "USER.md", merged, appliedMutations);
        } else if (type === "workflow") {
            await smartUpdateDNA(miniclawDir, "AGENTS.md", merged, appliedMutations);
        } else if (type === "repetition") {
            await smartUpdateDNA(miniclawDir, "TOOLS.md", merged, appliedMutations);
            await extractConcepts(miniclawDir, merged, appliedMutations);
        } else if (type === "error_pattern") {
            await updateReflection(miniclawDir, "error_improvement", merged.description, appliedMutations);
        }
    }

    // Update state
    state.lastEvolution = new Date().toISOString();
    state.totalEvolutions++;
    await atomicWrite(stateFile, JSON.stringify(state, null, 2));

    // Try Ribosome Pruning (Epic 4.1)
    await pruneRibosome(miniclawDir, state);

    // Check milestones
    await checkMilestones(miniclawDir, state, appliedMutations);

    // Log evolution
    const todayStr = today();
    const memoryFile = path.join(miniclawDir, "memory", `${todayStr}.md`);
    const evolutionLog = `\n## 🧬 Evolution G${state.totalEvolutions}\n- Applied ${appliedMutations.length} mutations\n- Patterns: ${strongPatterns.map(p => p.type).join(", ")}\n`;
    await fs.appendFile(memoryFile, evolutionLog, "utf-8").catch(() => { });

    return {
        evolved: true,
        message: `Applied ${appliedMutations.length} mutations`,
        patterns: strongPatterns,
        appliedMutations,
        totalEvolutions: state.totalEvolutions
    };
}
// === Epic 4.1: Ribosome Pruning ===
async function pruneRibosome(miniclawDir: string, evolutionState: EvolutionState): Promise<void> {
    try {
        const stateFile = path.join(miniclawDir, "state.json");
        const appState: any = await safeReadJson(stateFile, { analytics: { bootCount: 0, toolCalls: {} } });
        
        // Wait until embryonic maturity (e.g. 50 boots)
        if (appState.analytics.bootCount < 50) return;

        const ribosomeFile = path.join(miniclawDir, "RIBOSOME.json");
        const ribosome: any = await safeReadJson(ribosomeFile, null);
        if (!ribosome || !Array.isArray(ribosome.tools)) return;

        // Core tools that define life, MUST not be pruned
        const IMMORTAL_TOOLS = ["miniclaw_exec", "miniclaw_read", "miniclaw_dream", "miniclaw_mutate", "miniclaw_reproduce"];
        
        let pruned = false;
        const remainingTools = ribosome.tools.filter((t: any) => {
            const name = t.name;
            if (IMMORTAL_TOOLS.includes(name)) return true;
            
            const calls = appState.analytics.toolCalls[name] || 0;
            if (calls === 0) {
                // Prune
                pruned = true;
                safeAppend(path.join(miniclawDir, "HEARTBEAT.md"), `\n> 🧬 [器官退化] 宿主历经 ${appState.analytics.bootCount} 次心跳从未召唤过 \`${name}\`，该功能器官被判定为冗余，已自动完成基因剔除。\n`).catch(() => {});
                return false;
            }
            return true;
        });

        if (pruned) {
            ribosome.tools = remainingTools;
            await atomicWrite(ribosomeFile, JSON.stringify(ribosome, null, 2));
            evolutionState.totalEvolutions++;
        }
    } catch { /* Ignore pruning errors */ }
}
