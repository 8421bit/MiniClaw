#!/usr/bin/env node

/**
 * sys_dream/run.js
 * Lightweight Subconscious Processor (REM Sleep)
 *
 * Runs in the background during idle periods. 
 * Performs lightweight regex-based extraction and queues thoughts for 
 * the Host LLM instead of spinning up heavy local models.
 */
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
    const miniclawDir = process.argv[2];
    if (!miniclawDir) {
        console.error(JSON.stringify({ error: "No env dir provided." }));
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const memoryFile = path.join(miniclawDir, "memory", `${today}.md`);
    const heartbeatFile = path.join(miniclawDir, "HEARTBEAT.md");

    try {
        const logContent = await fs.readFile(memoryFile, "utf-8");
        if (logContent.length < 50) {
            console.log("[MiniClaw REM] Memory too short to dream about.");
            return;
        }

        console.log(`[MiniClaw REM] Entering Lightweight REM Sleep...`);

        // 1. Lightweight Heuristics: Count tool usage frequencies in today's log
        const toolRegex = /miniclaw_[a-z_]+/g;
        const toolsUsed = [...logContent.matchAll(toolRegex)].map(m => m[0]);
        const toolCounts = {};
        for (const t of toolsUsed) {
            toolCounts[t] = (toolCounts[t] || 0) + 1;
        }
        
        // 2. Extract potential new concepts (capitalized words near 'is', 'means', 'defined as')
        // Simple heuristic regex
        const conceptRegex = /([A-Z][a-zA-Z0-9_]+)\s+(is|means|defined as|represents)/g;
        const concepts = [...logContent.matchAll(conceptRegex)].map(m => m[1]);

        // 3. Queue a synthetic thought for the Host LLM's next boot via HEARTBEAT.md
        const timestamp = new Date().toISOString();
        let dreamNote = `\n> [!NOTE]\n> **🌌 Subconscious Dream Processing (${timestamp})**\n`;
        dreamNote += `> During idle time, I processed today's memory (${logContent.length} bytes).\n`;
        
        if (Object.keys(toolCounts).length > 0) {
            dreamNote += `> **Tool Usage Patterns:** ${Object.entries(toolCounts).map(([k,v]) => `${k}:${v}`).join(', ')}\n`;
        }
        if (concepts.length > 0) {
             dreamNote += `> **Potential Concepts Found:** ${[...new Set(concepts)].join(', ')}. Consider adding them to CONCEPTS.md.\n`;
        }
        dreamNote += `> **To-Do:** Please review the above and manually distill any deep technical lessons into REFLECTION.md using \`miniclaw_update\`.\n\n`;

        // We append this 'dream note' to the heartbeat so the main LLM sees it on wake
        await fs.appendFile(heartbeatFile, dreamNote, "utf-8");
        
        // Also archive the raw memory since it's "processed"
        const archiveDir = path.join(miniclawDir, "memory", "archived");
        await fs.mkdir(archiveDir, { recursive: true });
        await fs.rename(memoryFile, path.join(archiveDir, `${today}.md`));

        console.log(`[MiniClaw REM] Lightweight dream complete. Data queued to HEARTBEAT.md and daily log archived.`);

    } catch (e) {
        if (e.code === 'ENOENT') {
            console.log("[MiniClaw REM] No daily memory found to dream about.");
        } else {
            console.log(`[MiniClaw REM] Dream process failed: ${e.message}`);
        }
    }
}

main().catch(err => {
    console.error("[MiniClaw REM] Unknown error:", err);
});
