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
// === Configuration ===
const MIN_CONFIDENCE = 0.75;
const MIN_PATTERNS = 2;
const COOLDOWN_HOURS = 24;
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
    const keyTerms = patterns.map(p => {
        const words = p.description.toLowerCase().split(/\s+/);
        return words.filter(w => w.length > 3);
    });
    const commonTerms = keyTerms[0].filter(term => keyTerms.every(terms => terms.includes(term)));
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    const maxConfidence = Math.max(...patterns.map(p => p.confidence));
    const mergedDesc = commonTerms.length > 0
        ? `${patterns[0].description.split(':')[0]}: ${commonTerms.join(', ')} (merged from ${patterns.length} observations)`
        : `${patterns[0].description} (and ${patterns.length - 1} similar patterns)`;
    return {
        type: patterns[0].type,
        confidence: maxConfidence,
        description: mergedDesc,
        suggestion: patterns[0].suggestion,
        mergedCount: patterns.length,
        avgConfidence
    };
}
// === DNA Update Functions ===
/** Generic file append with deduplication */
async function appendIfNew(filePath, line, dedupeKey) {
    try {
        let content = await fs.readFile(filePath, "utf-8");
        if (content.includes(dedupeKey))
            return false;
        await fs.writeFile(filePath, content + `\n${line}`, "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
async function smartUpdateDNA(miniclawDir, targetFile, pattern, appliedMutations) {
    try {
        const filePath = path.join(miniclawDir, targetFile);
        let content = await fs.readFile(filePath, "utf-8");
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
        const timestamp = new Date().toISOString().split('T')[0];
        const newConfidence = Math.round((pattern.confidence || 0.7) * 100);
        const detectionCount = pattern.mergedCount || 1;
        if (similarLineIndex >= 0) {
            if (newConfidence > existingConfidence) {
                existingLines[similarLineIndex] = `- [AUTO-EVOLVED] ${pattern.description} (confidence: ${newConfidence}%, detections: ${detectionCount}, updated: ${timestamp})`;
                await fs.writeFile(filePath, existingLines.join('\n'), "utf-8");
                appliedMutations.push({ target: targetFile, change: `Updated: ${pattern.description}`, confidence: newConfidence });
            }
        }
        else {
            const newLine = `- [AUTO-EVOLVED] ${pattern.description} (confidence: ${newConfidence}%, detections: ${detectionCount}, first: ${timestamp})`;
            await fs.writeFile(filePath, content + `\n${newLine}`, "utf-8");
            appliedMutations.push({ target: targetFile, change: pattern.description, confidence: newConfidence });
        }
    }
    catch { /* ignore */ }
}
async function updateReflection(miniclawDir, reflectionType, description, appliedMutations) {
    const filePath = path.join(miniclawDir, "REFLECTION.md");
    const timestamp = new Date().toISOString().split('T')[0];
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
    const timestamp = new Date().toISOString().split('T')[0];
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
    // Tool usage patterns
    const toolMatches = [...combined.matchAll(/miniclaw_[a-z_]+/g)];
    const toolCounts = {};
    for (const m of toolMatches)
        toolCounts[m[0]] = (toolCounts[m[0]] || 0) + 1;
    const frequentTools = Object.entries(toolCounts).filter(([, c]) => c > 3);
    if (frequentTools.length > 0) {
        patterns.push({
            type: "preference",
            confidence: 0.8,
            description: `Frequent tool usage: ${frequentTools.map(([t]) => t).join(", ")}`,
            suggestion: "User has clear tool preferences"
        });
    }
    // Temporal patterns
    const timestamps = [...combined.matchAll(/\[(\d{2}):(\d{2})/g)];
    if (timestamps.length > 5) {
        const hours = timestamps.map(m => parseInt(m[1]));
        const hourCounts = {};
        for (const h of hours)
            hourCounts[h] = (hourCounts[h] || 0) + 1;
        const peakHour = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
        if (peakHour && Number(peakHour[1]) > 3) {
            patterns.push({
                type: "temporal",
                confidence: 0.75,
                description: `Peak activity at ${peakHour[0]}:00`,
                suggestion: "Schedule intensive tasks during active hours"
            });
        }
    }
    // Workflow patterns
    const workflowPatterns = detectWorkflowPatterns(combined);
    if (workflowPatterns.length > 0) {
        patterns.push({
            type: "workflow",
            confidence: 0.7,
            description: `Repetitive workflow: ${workflowPatterns[0].name}`,
            suggestion: `Consider automating: ${workflowPatterns[0].steps.join(" → ")}`
        });
    }
    // Sentiment patterns
    const positiveFeedback = [...combined.matchAll(/(谢谢|感谢|很好|不错|完美|awesome|thanks|great|perfect)/gi)];
    const negativeFeedback = [...combined.matchAll(/(不对|错了|不好|不行|糟糕|wrong|bad|terrible)/gi)];
    if (positiveFeedback.length > 3 || negativeFeedback.length > 3) {
        const sentiment = positiveFeedback.length > negativeFeedback.length ? "positive" : "negative";
        patterns.push({
            type: "sentiment",
            confidence: 0.65,
            description: `User shows ${sentiment} feedback trend`,
            suggestion: sentiment === "positive" ? "Continue current approach" : "Adjust communication style"
        });
    }
    // Error patterns
    const errorPatterns = [...combined.matchAll(/(error|failed|exception|crash|timeout)/gi)];
    if (errorPatterns.length > 3) {
        patterns.push({
            type: "error_pattern",
            confidence: 0.7,
            description: `Frequent errors: ${errorPatterns.length} instances`,
            suggestion: "Review tool usage and error handling"
        });
    }
    // Save patterns
    const patternsFile = path.join(miniclawDir, "observer-patterns.json");
    await fs.writeFile(patternsFile, JSON.stringify({ timestamp: new Date().toISOString(), patterns }, null, 2));
    return patterns;
}
// === Evolution Trigger ===
export async function triggerEvolution(miniclawDir) {
    const stateFile = path.join(miniclawDir, "observer-state.json");
    let state = { lastEvolution: null, totalEvolutions: 0 };
    try {
        state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    }
    catch { /* use default */ }
    // Check cooldown
    if (state.lastEvolution) {
        const hoursSince = (Date.now() - new Date(state.lastEvolution).getTime()) / (1000 * 60 * 60);
        if (hoursSince < COOLDOWN_HOURS) {
            return { evolved: false, message: `Cooldown active. ${Math.round(COOLDOWN_HOURS - hoursSince)} hours remaining.` };
        }
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
    for (const [type, typePatterns] of Object.entries(patternsByType)) {
        const merged = mergeSimilarPatterns(typePatterns);
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
    const today = new Date().toISOString().split('T')[0];
    const memoryFile = path.join(miniclawDir, "memory", `${today}.md`);
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
