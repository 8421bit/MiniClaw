#!/usr/bin/env node

/**
 * sys_observer/run.js
 * Pattern Detection and DNA Evolution Engine
 *
 * Lightweight implementation that analyzes memory files,
 * detects patterns, and triggers DNA updates for implicit learning.
 */

import fs from "node:fs/promises";
import path from "node:path";

const MIN_CONFIDENCE = 0.75;
const MIN_PATTERNS = 2;
const COOLDOWN_HOURS = 24;

async function main() {
    const miniclawDir = process.argv[2];
    const action = process.argv[3] || "analyze"; // analyze or evolve
    
    if (!miniclawDir) {
        console.error(JSON.stringify({ error: "No env dir provided." }));
        return;
    }

    try {
        if (action === "analyze") {
            await analyzePatterns(miniclawDir);
        } else if (action === "evolve") {
            await triggerEvolution(miniclawDir);
        } else {
            console.error(JSON.stringify({ error: `Unknown action: ${action}` }));
        }
    } catch (e) {
        console.error(JSON.stringify({ error: e.message }));
    }
}

async function analyzePatterns(miniclawDir) {
    const memoryDir = path.join(miniclawDir, "memory");
    const patterns = [];
    
    // Read recent memory files (last 7 days)
    const files = await fs.readdir(memoryDir).catch(() => []);
    const mdFiles = files
        .filter(f => f.endsWith(".md") && !f.includes("archived"))
        .sort()
        .slice(-7);
    
    if (mdFiles.length === 0) {
        console.log(JSON.stringify({ patterns: [], message: "No memory files found" }));
        return;
    }

    // Simple pattern detection heuristics
    const allContent = [];
    for (const file of mdFiles) {
        const content = await fs.readFile(path.join(memoryDir, file), "utf-8");
        allContent.push(content);
    }
    const combined = allContent.join("\n");

    // Detect repetition patterns (same questions)
    const questions = [...combined.matchAll(/用户问|问|how to|怎么/gi)];
    if (questions.length > 5) {
        patterns.push({
            type: "repetition",
            confidence: Math.min(0.9, questions.length / 10),
            description: `Detected ${questions.length} question patterns`,
            suggestion: "Consider creating skills for frequently asked questions"
        });
    }

    // Detect tool usage patterns
    const toolMatches = [...combined.matchAll(/miniclaw_[a-z_]+/g)];
    const toolCounts = {};
    for (const m of toolMatches) {
        toolCounts[m[0]] = (toolCounts[m[0]] || 0) + 1;
    }
    
    const frequentTools = Object.entries(toolCounts).filter(([_, c]) => c > 3);
    if (frequentTools.length > 0) {
        patterns.push({
            type: "preference",
            confidence: 0.8,
            description: `Frequent tool usage: ${frequentTools.map(([t]) => t).join(", ")}`,
            suggestion: "User has clear tool preferences"
        });
    }

    // Detect temporal patterns (if timestamps available)
    const timestamps = [...combined.matchAll(/\[(\d{2}):(\d{2})/g)];
    if (timestamps.length > 5) {
        const hours = timestamps.map(m => parseInt(m[1]));
        const hourCounts = {};
        for (const h of hours) {
            hourCounts[h] = (hourCounts[h] || 0) + 1;
        }
        const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
        if (peakHour && peakHour[1] > 3) {
            patterns.push({
                type: "temporal",
                confidence: 0.75,
                description: `Peak activity at ${peakHour[0]}:00`,
                suggestion: "Schedule intensive tasks during active hours"
            });
        }
    }

    // Save patterns for evolution
    const patternsFile = path.join(miniclawDir, "observer-patterns.json");
    await fs.writeFile(patternsFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        patterns,
        totalInteractions: questions.length
    }, null, 2));

    console.log(JSON.stringify({ 
        patterns, 
        message: `Detected ${patterns.length} patterns from ${mdFiles.length} days` 
    }));
}

async function triggerEvolution(miniclawDir) {
    // Check cooldown
    const stateFile = path.join(miniclawDir, "observer-state.json");
    let state = { lastEvolution: null, totalEvolutions: 0 };
    
    try {
        state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
    } catch { /* use default */ }

    if (state.lastEvolution) {
        const hoursSince = (Date.now() - new Date(state.lastEvolution).getTime()) / (1000 * 60 * 60);
        if (hoursSince < COOLDOWN_HOURS) {
            console.log(JSON.stringify({
                evolved: false,
                message: `Cooldown active. ${Math.round(COOLDOWN_HOURS - hoursSince)} hours remaining.`
            }));
            return;
        }
    }

    // Load patterns
    const patternsFile = path.join(miniclawDir, "observer-patterns.json");
    let patterns = [];
    try {
        const data = JSON.parse(await fs.readFile(patternsFile, "utf-8"));
        patterns = data.patterns || [];
    } catch {
        console.log(JSON.stringify({ evolved: false, message: "No patterns to evolve from" }));
        return;
    }

    // Filter strong patterns
    const strongPatterns = patterns.filter(p => p.confidence >= MIN_CONFIDENCE);
    if (strongPatterns.length < MIN_PATTERNS) {
        console.log(JSON.stringify({
            evolved: false,
            message: `Insufficient strong patterns (${strongPatterns.length}/${MIN_PATTERNS})`
        }));
        return;
    }

    // Generate and APPLY evolution proposals
    const proposals = [];
    const appliedMutations = [];
    
    for (const p of strongPatterns.slice(0, 3)) {
        if (p.type === "repetition") {
            proposals.push({
                target: "TOOLS.md",
                section: "Suggested Skills",
                content: `- Auto-generated skill for: ${p.description}`,
                reasoning: p.suggestion
            });
        } else if (p.type === "preference") {
            proposals.push({
                target: "SOUL.md",
                section: "Communication Style",
                content: `- User prefers: ${p.description}`,
                reasoning: "Adapt to user preferences"
            });
            // AUTO-APPLY: Update SOUL.md with preference
            try {
                const soulFile = path.join(miniclawDir, "SOUL.md");
                let soulContent = await fs.readFile(soulFile, "utf-8");
                const preferenceLine = `\n- [AUTO-EVOLVED] ${p.description} (detected at ${new Date().toISOString()})`;
                if (!soulContent.includes(p.description)) {
                    soulContent += preferenceLine;
                    await fs.writeFile(soulFile, soulContent, "utf-8");
                    appliedMutations.push({ target: "SOUL.md", change: p.description });
                }
            } catch (e) {
                console.error(JSON.stringify({ error: `Failed to update SOUL.md: ${e.message}` }));
            }
        } else if (p.type === "temporal") {
            proposals.push({
                target: "USER.md",
                section: "Temporal Patterns",
                content: `- ${p.description}`,
                reasoning: p.suggestion
            });
            // AUTO-APPLY: Update USER.md with temporal pattern
            try {
                const userFile = path.join(miniclawDir, "USER.md");
                let userContent = await fs.readFile(userFile, "utf-8");
                const temporalLine = `\n- [AUTO-EVOLVED] ${p.description} (detected at ${new Date().toISOString()})`;
                if (!userContent.includes(p.description)) {
                    userContent += temporalLine;
                    await fs.writeFile(userFile, userContent, "utf-8");
                    appliedMutations.push({ target: "USER.md", change: p.description });
                }
            } catch (e) {
                console.error(JSON.stringify({ error: `Failed to update USER.md: ${e.message}` }));
            }
        }
    }

    // Update state
    state.lastEvolution = new Date().toISOString();
    state.totalEvolutions++;
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));

    // Write evolution log to daily memory
    const today = new Date().toISOString().split('T')[0];
    const memoryFile = path.join(miniclawDir, "memory", `${today}.md`);
    const timestamp = new Date().toISOString();
    
    let evolutionLog = `\n## 🧬 Evolution Log\n\n`;
    evolutionLog += `- [${timestamp}] [EVOLUTION_TRIGGERED] Generation ${state.totalEvolutions}\n`;
    evolutionLog += `- [${timestamp}] [PATTERNS_DETECTED] ${strongPatterns.length} strong patterns:\n`;
    for (const p of strongPatterns) {
        evolutionLog += `  - ${p.type}: ${p.description} (confidence: ${(p.confidence * 100).toFixed(0)}%)\n`;
    }
    evolutionLog += `- [${timestamp}] [PROPOSALS_GENERATED] ${proposals.length} DNA updates proposed:\n`;
    for (const p of proposals) {
        const chrMap = { "TOOLS.md": "Chr-4", "SOUL.md": "Chr-2", "USER.md": "Chr-3" };
        const chr = chrMap[p.target] || "Unknown";
        evolutionLog += `  - [GENE_MUTATION] ${chr}: ${p.reasoning}\n`;
    }
    if (appliedMutations.length > 0) {
        evolutionLog += `- [${timestamp}] [AUTO_APPLIED] ${appliedMutations.length} mutations:\n`;
        for (const m of appliedMutations) {
            evolutionLog += `  - ${m.target}: ${m.change}\n`;
        }
    }
    evolutionLog += `- [${timestamp}] [STATUS] Evolution complete\n\n`;
    
    await fs.appendFile(memoryFile, evolutionLog, "utf-8").catch(() => {
        // If memory file doesn't exist, skip silently
    });

    console.log(JSON.stringify({
        evolved: true,
        message: `Generated ${proposals.length} evolution proposals, applied ${appliedMutations.length} mutations`,
        proposals,
        appliedMutations,
        totalEvolutions: state.totalEvolutions
    }));
}

main().catch(err => {
    console.error(JSON.stringify({ error: err.message }));
});
