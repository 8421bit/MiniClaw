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

// Merge similar patterns to avoid duplication
function mergeSimilarPatterns(patterns) {
    if (patterns.length === 1) return patterns[0];
    
    // Extract key terms from descriptions
    const keyTerms = patterns.map(p => {
        const words = p.description.toLowerCase().split(/\s+/);
        return words.filter(w => w.length > 3); // Filter significant words
    });
    
    // Find common terms
    const commonTerms = keyTerms[0].filter(term => 
        keyTerms.every(terms => terms.includes(term))
    );
    
    // Calculate average confidence
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    const maxConfidence = Math.max(...patterns.map(p => p.confidence));
    
    // Build merged description
    const mergedDesc = commonTerms.length > 0 
        ? `${patterns[0].description.split(':')[0]}: ${commonTerms.join(', ')} (merged from ${patterns.length} observations)`
        : `${patterns[0].description} (and ${patterns.length - 1} similar patterns)`;
    
    return {
        type: patterns[0].type,
        confidence: maxConfidence,
        description: mergedDesc,
        suggestion: patterns[0].suggestion,
        mergedCount: patterns.length,
        avgConfidence: avgConfidence
    };
}

// Smart DNA update with duplicate detection and confidence tracking
async function smartUpdateDNA(miniclawDir, targetFile, section, pattern, appliedMutations) {
    try {
        const filePath = path.join(miniclawDir, targetFile);
        let content = await fs.readFile(filePath, "utf-8");
        
        // Extract key concept from description (first 50 chars or key phrase)
        const keyConcept = pattern.description.substring(0, 50).replace(/\s+/g, ' ').trim();
        
        // Check if similar content already exists
        const existingLines = content.split('\n');
        let similarLineIndex = -1;
        let existingConfidence = 0;
        
        for (let i = 0; i < existingLines.length; i++) {
            const line = existingLines[i];
            // Check for [AUTO-EVOLVED] lines with similar content
            if (line.includes('[AUTO-EVOLVED]')) {
                const similarity = calculateSimilarity(line, keyConcept);
                if (similarity > 0.6) { // 60% similarity threshold
                    similarLineIndex = i;
                    // Extract existing confidence if present
                    const confidenceMatch = line.match(/confidence:\s*([\d.]+)/);
                    if (confidenceMatch) {
                        existingConfidence = parseFloat(confidenceMatch[1]);
                    }
                    break;
                }
            }
        }
        
        const timestamp = new Date().toISOString();
        const newConfidence = Math.round((pattern.confidence || 0.7) * 100);
        const detectionCount = pattern.mergedCount || 1;
        
        if (similarLineIndex >= 0) {
            // Update existing line with merged info
            if (newConfidence > existingConfidence) {
                const updatedLine = `- [AUTO-EVOLVED] ${pattern.description} (confidence: ${newConfidence}%, detections: ${detectionCount}, updated: ${timestamp.split('T')[0]})`;
                existingLines[similarLineIndex] = updatedLine;
                content = existingLines.join('\n');
                await fs.writeFile(filePath, content, "utf-8");
                appliedMutations.push({ target: targetFile, change: `Updated: ${pattern.description}`, confidence: newConfidence });
            }
        } else {
            // Add new line
            const newLine = `- [AUTO-EVOLVED] ${pattern.description} (confidence: ${newConfidence}%, detections: ${detectionCount}, first: ${timestamp.split('T')[0]})`;
            content += `\n${newLine}`;
            await fs.writeFile(filePath, content, "utf-8");
            appliedMutations.push({ target: targetFile, change: pattern.description, confidence: newConfidence });
        }
    } catch (e) {
        console.error(JSON.stringify({ error: `Failed to update ${targetFile}: ${e.message}` }));
    }
}

// Update HEARTBEAT.md with discovered workflow tasks
async function updateHeartbeatTasks(miniclawDir, pattern, appliedMutations) {
    try {
        const heartbeatFile = path.join(miniclawDir, "HEARTBEAT.md");
        let content = await fs.readFile(heartbeatFile, "utf-8");
        
        const taskLine = `\n- [AUTO-EVOLVED] Workflow task: ${pattern.description} (discovered: ${new Date().toISOString().split('T')[0]})`;
        
        if (!content.includes(pattern.description.substring(0, 30))) {
            content += taskLine;
            await fs.writeFile(heartbeatFile, content, "utf-8");
            appliedMutations.push({ chromosome: "Chr-Heartbeat", target: "HEARTBEAT.md", change: `Added workflow task: ${pattern.description}` });
        }
    } catch (e) {
        console.error(JSON.stringify({ error: `Failed to update HEARTBEAT.md: ${e.message}` }));
    }
}

// Update REFLECTION.md with self-reflection
async function updateReflection(miniclawDir, reflectionType, description, appliedMutations) {
    try {
        const reflectionFile = path.join(miniclawDir, "REFLECTION.md");
        let content = await fs.readFile(reflectionFile, "utf-8");
        
        const reflectionLine = `\n- [AUTO-EVOLVED] ${reflectionType}: ${description} (reflected: ${new Date().toISOString().split('T')[0]})`;
        
        // Check for similar reflection
        const keyConcept = description.substring(0, 40);
        if (!content.includes(keyConcept)) {
            content += reflectionLine;
            await fs.writeFile(reflectionFile, content, "utf-8");
            appliedMutations.push({ chromosome: "Chr-7", target: "REFLECTION.md", change: `${reflectionType}: ${description}` });
        }
    } catch (e) {
        console.error(JSON.stringify({ error: `Failed to update REFLECTION.md: ${e.message}` }));
    }
}

// Extract concepts from patterns and add to CONCEPTS.md
async function extractConcepts(miniclawDir, pattern, appliedMutations) {
    try {
        const conceptsFile = path.join(miniclawDir, "CONCEPTS.md");
        let content = await fs.readFile(conceptsFile, "utf-8");
        
        // Extract potential concept names (capitalized words or quoted terms)
        const conceptMatches = pattern.description.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g) || [];
        
        for (const concept of conceptMatches.slice(0, 3)) {
            if (concept.length > 3 && !content.includes(concept)) {
                const conceptLine = `\n- **${concept}**: [AUTO-EVOLVED] Frequently mentioned concept detected from user interactions.`;
                content += conceptLine;
                appliedMutations.push({ chromosome: "Chr-6", target: "CONCEPTS.md", change: `Added concept: ${concept}` });
            }
        }
        
        await fs.writeFile(conceptsFile, content, "utf-8");
    } catch (e) {
        console.error(JSON.stringify({ error: `Failed to update CONCEPTS.md: ${e.message}` }));
    }
}

// Extract concepts from all memory content
async function extractConceptsFromAllContent(miniclawDir, patterns, appliedMutations) {
    try {
        const memoryDir = path.join(miniclawDir, "memory");
        const files = await fs.readdir(memoryDir).catch(() => []);
        const mdFiles = files.filter(f => f.endsWith(".md") && !f.includes("archived")).slice(-3);
        
        let allContent = "";
        for (const file of mdFiles) {
            const content = await fs.readFile(path.join(memoryDir, file), "utf-8");
            allContent += content + "\n";
        }
        
        // Extract technical terms (camelCase, PascalCase, or technical jargon)
        const techTerms = [...allContent.matchAll(/\b([A-Z][a-z]+[A-Z][a-zA-Z]+)\b/g)].map(m => m[1]);
        const uniqueTerms = [...new Set(techTerms)].filter(t => t.length > 4).slice(0, 5);
        
        if (uniqueTerms.length > 0) {
            const conceptsFile = path.join(miniclawDir, "CONCEPTS.md");
            let content = await fs.readFile(conceptsFile, "utf-8");
            
            let added = 0;
            for (const term of uniqueTerms) {
                if (!content.includes(term)) {
                    const conceptLine = `\n- **${term}**: [AUTO-EVOLVED] Technical term detected in recent interactions.`;
                    content += conceptLine;
                    added++;
                }
            }
            
            if (added > 0) {
                await fs.writeFile(conceptsFile, content, "utf-8");
                appliedMutations.push({ chromosome: "Chr-6", target: "CONCEPTS.md", change: `Added ${added} technical concepts` });
            }
        }
    } catch (e) {
        console.error(JSON.stringify({ error: `Failed to extract concepts: ${e.message}` }));
    }
}

// Check for milestone achievements and update HORIZONS.md
async function checkMilestones(miniclawDir, appliedMutations) {
    try {
        const stateFile = path.join(miniclawDir, "observer-state.json");
        let state = { lastEvolution: null, totalEvolutions: 0, milestones: [] };
        try {
            state = JSON.parse(await fs.readFile(stateFile, "utf-8"));
        } catch { /* use default */ }
        
        const milestones = [];
        if (state.totalEvolutions === 1) milestones.push("First DNA Evolution");
        if (state.totalEvolutions === 5) milestones.push("5th Generation Evolution");
        if (state.totalEvolutions === 10) milestones.push("10th Generation Evolution - Stable Learning");
        
        for (const milestone of milestones) {
            const horizonsFile = path.join(miniclawDir, "HORIZONS.md");
            let content = await fs.readFile(horizonsFile, "utf-8");
            
            if (!content.includes(milestone)) {
                const milestoneLine = `\n- [AUTO-EVOLVED] Milestone achieved: ${milestone} (G${state.totalEvolutions}, ${new Date().toISOString().split('T')[0]})`;
                content += milestoneLine;
                await fs.writeFile(horizonsFile, content, "utf-8");
                appliedMutations.push({ chromosome: "Chr-8", target: "HORIZONS.md", change: `Milestone: ${milestone}` });
            }
        }
    } catch (e) {
        console.error(JSON.stringify({ error: `Failed to check milestones: ${e.message}` }));
    }
}

// Calculate similarity between two strings (0-1)
function calculateSimilarity(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    // Simple word overlap similarity
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

// Detect workflow patterns from memory content
function detectWorkflowPatterns(content) {
    const workflows = [];
    
    // Look for common tool sequences
    const toolSequence = [...content.matchAll(/miniclaw_(\w+)/g)].map(m => m[0]);
    if (toolSequence.length >= 6) {
        // Check for repeated 2-3 tool sequences
        for (let len = 2; len <= 3; len++) {
            const sequences = {};
            for (let i = 0; i <= toolSequence.length - len; i++) {
                const seq = toolSequence.slice(i, i + len).join(" → ");
                sequences[seq] = (sequences[seq] || 0) + 1;
            }
            const repeated = Object.entries(sequences).filter(([_, count]) => count >= 2);
            if (repeated.length > 0) {
                const [topSeq, count] = repeated.sort((a, b) => b[1] - a[1])[0];
                workflows.push({
                    name: `Repeated ${len}-step workflow`,
                    steps: topSeq.split(" → "),
                    frequency: count
                });
            }
        }
    }
    
    return workflows;
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

    // Detect workflow patterns (repeated action sequences)
    const workflowPatterns = detectWorkflowPatterns(combined);
    if (workflowPatterns.length > 0) {
        patterns.push({
            type: "workflow",
            confidence: 0.7,
            description: `Repetitive workflow detected: ${workflowPatterns[0].name}`,
            suggestion: `Consider automating: ${workflowPatterns[0].steps.join(" → ")}`
        });
    }

    // Detect sentiment patterns (user feedback)
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

    // Detect error patterns
    const errorPatterns = [...combined.matchAll(/(error|failed|exception|crash|timeout)/gi)];
    if (errorPatterns.length > 3) {
        patterns.push({
            type: "error_pattern",
            confidence: 0.7,
            description: `Frequent errors detected: ${errorPatterns.length} instances`,
            suggestion: "Review tool usage and error handling"
        });
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

    // Generate and APPLY evolution proposals with intelligent merging
    const proposals = [];
    const appliedMutations = [];
    
    // Group patterns by type for intelligent merging
    const patternsByType = {};
    for (const p of strongPatterns) {
        if (!patternsByType[p.type]) patternsByType[p.type] = [];
        patternsByType[p.type].push(p);
    }
    
    // Process each pattern type with smart merging - FULL GENOME EVOLUTION
    for (const [type, typePatterns] of Object.entries(patternsByType)) {
        if (type === "preference") {
            // Chr-2: SOUL.md - Communication Style & Adaptation
            const mergedPreference = mergeSimilarPatterns(typePatterns);
            proposals.push({ chromosome: "Chr-2", target: "SOUL.md", section: "Communication Style", content: mergedPreference.description });
            await smartUpdateDNA(miniclawDir, "SOUL.md", mergedPreference, appliedMutations);
            
        } else if (type === "temporal") {
            // Chr-3: USER.md - Temporal Patterns & Rhythms
            const mergedTemporal = mergeSimilarPatterns(typePatterns);
            proposals.push({ chromosome: "Chr-3", target: "USER.md", section: "Temporal Patterns", content: mergedTemporal.description });
            await smartUpdateDNA(miniclawDir, "USER.md", mergedTemporal, appliedMutations);
            
        } else if (type === "workflow") {
            // Chr-?: AGENTS.md - Suggested Workflows
            const mergedWorkflow = mergeSimilarPatterns(typePatterns);
            proposals.push({ chromosome: "Chr-Agents", target: "AGENTS.md", section: "Auto-Discovered Workflows", content: mergedWorkflow.description });
            await smartUpdateDNA(miniclawDir, "AGENTS.md", mergedWorkflow, appliedMutations);
            
            // Also update HEARTBEAT.md with workflow tasks
            await updateHeartbeatTasks(miniclawDir, mergedWorkflow, appliedMutations);
            
        } else if (type === "sentiment") {
            // Chr-2: SOUL.md - Adaptation Notes & Emotional Intelligence
            const sentimentPattern = typePatterns[0];
            const sentimentDesc = sentimentPattern.description.includes("negative") 
                ? "User shows negative feedback trend - prioritize accuracy over speed"
                : "User shows positive feedback trend - maintain current approach";
            proposals.push({ chromosome: "Chr-2", target: "SOUL.md", section: "Emotional Intelligence", content: sentimentDesc });
            await smartUpdateDNA(miniclawDir, "SOUL.md", { ...sentimentPattern, description: sentimentDesc }, appliedMutations);
            
            // Chr-7: REFLECTION.md - Self-reflection on emotional adaptation
            await updateReflection(miniclawDir, "emotional_adaptation", sentimentDesc, appliedMutations);
            
        } else if (type === "repetition") {
            // Chr-4: TOOLS.md - Suggested Skills & Knowledge Gaps
            const mergedRepetition = mergeSimilarPatterns(typePatterns);
            proposals.push({ chromosome: "Chr-4", target: "TOOLS.md", section: "Auto-Discovered Needs", content: mergedRepetition.description });
            await smartUpdateDNA(miniclawDir, "TOOLS.md", mergedRepetition, appliedMutations);
            
            // Chr-6: CONCEPTS.md - Extract new concepts from repeated questions
            await extractConcepts(miniclawDir, mergedRepetition, appliedMutations);
            
        } else if (type === "error_pattern") {
            // Chr-7: REFLECTION.md - Error reflection & improvement
            const mergedError = mergeSimilarPatterns(typePatterns);
            proposals.push({ chromosome: "Chr-7", target: "REFLECTION.md", section: "Error Patterns", content: mergedError.description });
            await updateReflection(miniclawDir, "error_improvement", mergedError.description, appliedMutations);
            
            // Chr-4: TOOLS.md - Note tool reliability issues
            await smartUpdateDNA(miniclawDir, "TOOLS.md", { ...mergedError, description: `Tool reliability issue: ${mergedError.description}` }, appliedMutations);
        }
    }
    
    // Always check for concept extraction from all interactions
    await extractConceptsFromAllContent(miniclawDir, strongPatterns, appliedMutations);
    
    // Check for milestone achievements
    await checkMilestones(miniclawDir, appliedMutations);

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
