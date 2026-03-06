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
import { today, nowIso, safeRead, safeWrite, safeReadJson, hoursSince } from "./utils.js";
// === Configuration ===
const MIN_CONFIDENCE = 0.75;
const MIN_PATTERNS = 2;
const COOLDOWN_HOURS = 24;
// === Epigenetic Configuration ===
// Controls how temporary adaptations become semi-permanent traits
const METHYLATION_THRESHOLD = 10; // Minimum pattern repetitions to trigger methylation
const METHYLATION_AGE_DAYS = 7; // Minimum age (days) for pattern to be considered stable
const METHYLATION_COOLDOWN_HOURS = 48; // Cooldown between SOUL.md modifications
// === Helper Functions ===
function calculateSimilarity(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
}
function mergeSimilarPatterns(patterns) {
    if (patterns.length === 1)
        return patterns[0];
    // Find common terms across all patterns
    const allTerms = patterns.map(p => p.description.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const commonTerms = allTerms[0].filter(term => allTerms.every(terms => terms.includes(term)));
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    return {
        type: patterns[0].type,
        confidence: Math.max(...patterns.map(p => p.confidence)),
        description: commonTerms.length > 0
            ? `${patterns[0].description.split(':')[0]}: ${commonTerms.join(', ')} (merged from ${patterns.length} observations)`
            : `${patterns[0].description} (and ${patterns.length - 1} similar)`,
        suggestion: patterns[0].suggestion,
        mergedCount: patterns.length,
        avgConfidence
    };
}
// === DNA Update Functions ===
/** Generic file append with deduplication */
async function appendIfNew(filePath, line, dedupeKey) {
    const content = await safeRead(filePath);
    if (content.includes(dedupeKey))
        return false;
    return safeWrite(filePath, content + `\n${line}`).then(() => true);
}
// === Epigenetic Functions ===
// Methylation: Semi-permanent adaptation without changing DNA sequence
async function loadMethylatedTraits(miniclawDir) {
    return safeReadJson(path.join(miniclawDir, "methylation.json"), []);
}
async function saveMethylatedTraits(miniclawDir, traits) {
    await safeWrite(path.join(miniclawDir, "methylation.json"), JSON.stringify(traits, null, 2));
}
async function getLastMethylationTime(miniclawDir) {
    const methylationFile = path.join(miniclawDir, "methylation.json");
    try {
        const stats = await fs.stat(methylationFile);
        return stats.mtime.getTime();
    }
    catch {
        return 0;
    }
}
// Check if a pattern should trigger methylation (semi-permanent adaptation)
async function shouldMethylate(pattern, existingTraits) {
    // Must be high confidence and repeated
    if (pattern.confidence < 0.8)
        return { should: false };
    if ((pattern.mergedCount || 1) < METHYLATION_THRESHOLD)
        return { should: false };
    // Extract trait and value from pattern description
    // Pattern: "Frequent tool usage: miniclaw_update, miniclaw_read" → trait: "tool_preference", value: "frequent_updater"
    let trait;
    let value;
    if (pattern.type === "preference" && pattern.description.includes("tool")) {
        trait = "interaction_style";
        value = pattern.description.includes("update") ? "proactive_modifier" : "active_reader";
    }
    else if (pattern.type === "temporal") {
        trait = "activity_pattern";
        value = "time_sensitive";
    }
    else if (pattern.type === "workflow") {
        trait = "workflow_style";
        value = "structured";
    }
    if (!trait || !value)
        return { should: false };
    // Check if already methylated with same or higher stability
    const existing = existingTraits.find(t => t.trait === trait);
    if (existing && existing.stability > 0.7) {
        return { should: false }; // Already stable
    }
    return { should: true, trait, value };
}
// Apply methylation: Update SOUL.md with semi-permanent adaptation
async function methylateTrait(miniclawDir, trait, value, pattern, appliedMutations) {
    // Check cooldown
    const lastMethylation = await getLastMethylationTime(miniclawDir);
    const hrsSince = (Date.now() - lastMethylation) / (1000 * 60 * 60);
    if (hrsSince < METHYLATION_COOLDOWN_HOURS) {
        console.error(`[MiniClaw] 🧬 Methylation cooldown: ${Math.round(METHYLATION_COOLDOWN_HOURS - hrsSince)}h remaining`);
        return;
    }
    const traits = await loadMethylatedTraits(miniclawDir);
    const stability = Math.min(0.95, 0.5 + (pattern.mergedCount || 1) * 0.05);
    const newTrait = { trait, value, source: pattern.description, timestamp: nowIso(), patternCount: pattern.mergedCount || 1, stability };
    const idx = traits.findIndex(t => t.trait === trait);
    idx >= 0 ? traits[idx] = newTrait : traits.push(newTrait);
    await saveMethylatedTraits(miniclawDir, traits);
    // Update SOUL.md
    const soulPath = path.join(miniclawDir, "SOUL.md");
    let soulContent = await safeRead(soulPath);
    if (!soulContent)
        return;
    const note = `\n<!-- [METHYLATED] ${trait}: ${value} (stability: ${Math.round(stability * 100)}%) -->`;
    soulContent = soulContent.replace(new RegExp(`\\n<!-- \\[METHYLATED\\] ${trait}: .*? -->`, 'g'), '') + note;
    await safeWrite(soulPath, soulContent);
    appliedMutations.push({ chromosome: "Chr-2 (SOUL)", target: "SOUL.md", change: `Methylated ${trait} → ${value}`, confidence: Math.round(stability * 100) });
    console.error(`[MiniClaw] 🧬 Methylation applied: ${trait} → ${value} (${Math.round(stability * 100)}% stable)`);
}
// Get current methylated traits for context assembly
export async function getMethylatedTraits(miniclawDir) {
    return loadMethylatedTraits(miniclawDir);
}
async function smartUpdateDNA(miniclawDir, targetFile, pattern, appliedMutations) {
    const filePath = path.join(miniclawDir, targetFile);
    const content = await safeRead(filePath);
    if (!content)
        return;
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
                if (confidenceMatch)
                    existingConfidence = parseFloat(confidenceMatch[1]);
                break;
            }
        }
    }
    const timestamp = today();
    const newConfidence = Math.round((pattern.confidence || 0.7) * 100);
    const detectionCount = pattern.mergedCount || 1;
    const newLine = `- [AUTO-EVOLVED] ${pattern.description} (confidence: ${newConfidence}%, detections: ${detectionCount}, ${similarLineIndex >= 0 ? 'updated' : 'first'}: ${timestamp})`;
    if (similarLineIndex >= 0) {
        if (newConfidence <= existingConfidence)
            return;
        existingLines[similarLineIndex] = newLine;
        await safeWrite(filePath, existingLines.join('\n'));
        appliedMutations.push({ target: targetFile, change: `Updated: ${pattern.description}`, confidence: newConfidence });
    }
    else {
        await safeWrite(filePath, content + `\n${newLine}`);
        appliedMutations.push({ target: targetFile, change: pattern.description, confidence: newConfidence });
    }
}
async function updateReflection(miniclawDir, reflectionType, description, appliedMutations) {
    const filePath = path.join(miniclawDir, "REFLECTION.md");
    const timestamp = today();
    const line = `- [AUTO-EVOLVED] ${reflectionType}: ${description} (reflected: ${timestamp})`;
    if (await appendIfNew(filePath, line, description.substring(0, 40))) {
        appliedMutations.push({ chromosome: "Chr-7", target: "REFLECTION.md", change: `${reflectionType}: ${description}` });
    }
}
async function extractConcepts(miniclawDir, pattern, appliedMutations) {
    const filePath = path.join(miniclawDir, "CONCEPTS.md");
    const conceptMatches = pattern.description.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g) || [];
    for (const concept of conceptMatches.slice(0, 3)) {
        if (concept.length > 3) {
            const line = `- **${concept}**: [AUTO-EVOLVED] Frequently mentioned concept.`;
            if (await appendIfNew(filePath, line, concept)) {
                appliedMutations.push({ chromosome: "Chr-6", target: "CONCEPTS.md", change: `Added concept: ${concept}` });
            }
        }
    }
}
async function checkMilestones(miniclawDir, state, appliedMutations) {
    const milestones = [];
    if (state.totalEvolutions === 1)
        milestones.push("First DNA Evolution");
    if (state.totalEvolutions === 5)
        milestones.push("5th Generation Evolution");
    if (state.totalEvolutions === 10)
        milestones.push("10th Generation - Stable Learning");
    const filePath = path.join(miniclawDir, "HORIZONS.md");
    const timestamp = today();
    for (const milestone of milestones) {
        const line = `- [AUTO-EVOLVED] Milestone: ${milestone} (G${state.totalEvolutions}, ${timestamp})`;
        if (await appendIfNew(filePath, line, milestone)) {
            appliedMutations.push({ chromosome: "Chr-8", target: "HORIZONS.md", change: `Milestone: ${milestone}` });
        }
    }
}
// === Pattern Detection ===
function detectWorkflowPatterns(content) {
    const workflows = [];
    const toolSequence = [...content.matchAll(/miniclaw_(\w+)/g)].map(m => m[0]);
    if (toolSequence.length >= 6) {
        for (let len = 2; len <= 3; len++) {
            const sequences = {};
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
export async function analyzePatterns(miniclawDir) {
    const memoryDir = path.join(miniclawDir, "memory");
    const patterns = [];
    const files = await fs.readdir(memoryDir).catch(() => []);
    const mdFiles = files.filter(f => f.endsWith(".md") && !f.includes("archived")).sort().slice(-7);
    if (mdFiles.length === 0)
        return patterns;
    const allContent = [];
    for (const file of mdFiles) {
        const content = await fs.readFile(path.join(memoryDir, file), "utf-8");
        allContent.push(content);
    }
    const combined = allContent.join("\n");
    // Repetition patterns
    const questions = [...combined.matchAll(/用户问|问|how to|怎么/gi)];
    if (questions.length > 5) {
        patterns.push({
            type: "repetition",
            confidence: Math.min(0.9, questions.length / 10),
            description: `Detected ${questions.length} question patterns`,
            suggestion: "Consider creating skills for frequently asked questions"
        });
    }
    // Pattern detection helper
    const addPattern = (type, confidence, desc, suggestion) => {
        patterns.push({ type, confidence, description: desc, suggestion });
    };
    // Tool usage patterns
    const toolMatches = [...combined.matchAll(/miniclaw_[a-z_]+/g)];
    const toolCounts = {};
    for (const m of toolMatches)
        toolCounts[m[0]] = (toolCounts[m[0]] || 0) + 1;
    const frequentTools = Object.entries(toolCounts).filter(([, c]) => c > 3);
    if (frequentTools.length > 0)
        addPattern("preference", 0.8, `Frequent tools: ${frequentTools.map(([t]) => t).join(", ")}`);
    // Temporal patterns
    const timestamps = [...combined.matchAll(/\[(\d{2}):(\d{2})/g)];
    if (timestamps.length > 5) {
        const hourCounts = {};
        for (const m of timestamps)
            hourCounts[parseInt(m[1])] = (hourCounts[parseInt(m[1])] || 0) + 1;
        const peak = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
        if (peak && peak[1] > 3)
            addPattern("temporal", 0.75, `Peak activity at ${peak[0]}:00`);
    }
    // Workflow patterns
    const workflows = detectWorkflowPatterns(combined);
    if (workflows.length > 0)
        addPattern("workflow", 0.7, `Workflow: ${workflows[0].name}`);
    // Sentiment patterns
    const pos = [...combined.matchAll(/(谢谢|感谢|很好|不错|perfect|great)/gi)].length;
    const neg = [...combined.matchAll(/(不对|错了|糟糕|wrong|bad)/gi)].length;
    if (pos > 3 || neg > 3)
        addPattern("sentiment", 0.65, `Feedback: ${pos > neg ? 'positive' : 'negative'}`);
    // Error patterns
    const errors = [...combined.matchAll(/(error|failed|exception|crash)/gi)].length;
    if (errors > 3)
        addPattern("error_pattern", 0.7, `${errors} errors detected`);
    // Save patterns
    await safeWrite(path.join(miniclawDir, "observer-patterns.json"), JSON.stringify({ timestamp: nowIso(), patterns }, null, 2));
    return patterns;
}
// === Evolution Trigger ===
export async function triggerEvolution(miniclawDir) {
    const stateFile = path.join(miniclawDir, "observer-state.json");
    let state = { lastEvolution: null, totalEvolutions: 0 };
    state = await safeReadJson(stateFile, state);
    // Check cooldown
    if (state.lastEvolution && hoursSince(state.lastEvolution) < COOLDOWN_HOURS) {
        const remaining = Math.round(COOLDOWN_HOURS - hoursSince(state.lastEvolution));
        return { evolved: false, message: `Cooldown active. ${remaining} hours remaining.` };
    }
    // Load patterns
    const patternsFile = path.join(miniclawDir, "observer-patterns.json");
    let patterns = [];
    try {
        const data = JSON.parse(await fs.readFile(patternsFile, "utf-8"));
        patterns = data.patterns || [];
    }
    catch {
        return { evolved: false, message: "No patterns to evolve from" };
    }
    // Filter strong patterns
    const strongPatterns = patterns.filter(p => p.confidence >= MIN_CONFIDENCE);
    if (strongPatterns.length < MIN_PATTERNS) {
        return { evolved: false, message: `Insufficient strong patterns (${strongPatterns.length}/${MIN_PATTERNS})` };
    }
    // Apply evolution
    const appliedMutations = [];
    const patternsByType = {};
    for (const p of strongPatterns) {
        if (!patternsByType[p.type])
            patternsByType[p.type] = [];
        patternsByType[p.type].push(p);
    }
    // Load existing methylated traits for epigenetic decisions
    const methylatedTraits = await loadMethylatedTraits(miniclawDir);
    for (const [type, typePatterns] of Object.entries(patternsByType)) {
        const merged = mergeSimilarPatterns(typePatterns);
        // ★ Epigenetic Methylation: Check if pattern should become semi-permanent
        const methylationCheck = await shouldMethylate(merged, methylatedTraits);
        if (methylationCheck.should && methylationCheck.trait && methylationCheck.value) {
            await methylateTrait(miniclawDir, methylationCheck.trait, methylationCheck.value, merged, appliedMutations);
        }
        if (type === "preference" || type === "sentiment") {
            await smartUpdateDNA(miniclawDir, "SOUL.md", merged, appliedMutations);
            if (type === "sentiment")
                await updateReflection(miniclawDir, "emotional_adaptation", merged.description, appliedMutations);
        }
        else if (type === "temporal") {
            await smartUpdateDNA(miniclawDir, "USER.md", merged, appliedMutations);
        }
        else if (type === "workflow") {
            await smartUpdateDNA(miniclawDir, "AGENTS.md", merged, appliedMutations);
        }
        else if (type === "repetition") {
            await smartUpdateDNA(miniclawDir, "TOOLS.md", merged, appliedMutations);
            await extractConcepts(miniclawDir, merged, appliedMutations);
        }
        else if (type === "error_pattern") {
            await updateReflection(miniclawDir, "error_improvement", merged.description, appliedMutations);
        }
    }
    // Update state
    state.lastEvolution = new Date().toISOString();
    state.totalEvolutions++;
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
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
