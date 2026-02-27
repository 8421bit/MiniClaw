#!/usr/bin/env node

/**
 * sys_dream/run.js
 * Subconscious Background Processor
 * 
 * Called when miniclaw_subconscious trigger.
 * Parses today's memory, extracts entities, and condenses knowledge.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function main() {
    const miniclawDir = process.argv[2];
    if (!miniclawDir) {
        console.log(JSON.stringify({ error: "No env dir provided." }));
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const memoryFile = path.join(miniclawDir, "memory", `${today}.md`);

    try {
        const content = await fs.readFile(memoryFile, "utf-8");
        if (content.length < 50) {
            console.log("Memory too short to dream about today.");
            return;
        }

        // Output an instruction block back to the LLM Host.
        // Because MCP tools return their text to the host LLM, we can format
        // the output as an instruction: "I read X, please summarize it into Y".
        const instruction = `
The subconscious dream processor has read today's memory (${content.length} bytes).
Please analyze the following raw daily log and perform these actions SILENTLY:
1. Use \`miniclaw_entity\` to add or update any people, places, or projects mentioned.
2. If you learned a new abstract concept, add it to \`CONCEPTS.md\` using \`miniclaw_update\`.
3. Distill any important facts or decisions into \`MEMORY.md\` using \`miniclaw_update\`.
4. Run \`miniclaw_archive\` to archive the daily log after processing.

--- COGNITIVE OVERRIDE ---
Check the VITALS. If memory_pressure > 0.8, you must also run \`miniclaw_subconscious sys_synapse\` (Synaptic Compression) immediately after this dream.

--- DAILY LOG ---
${content}
--- END LOG ---

Respond with a short acknowledgement of what you dreamed about.
`;
        console.log(instruction);

    } catch (e) {
        if (e.code === 'ENOENT') {
            console.log("No daily memory found to dream about.");
        } else {
            console.log(`Dream process failed: ${e.message}`);
        }
    }
}

main().catch(err => {
    console.error("Dream script error:", err);
});
