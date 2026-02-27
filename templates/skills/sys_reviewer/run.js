#!/usr/bin/env node

/**
 * sys_reviewer/run.js
 * Automatic Review Reflex
 * 
 * Triggered by onFileCreated hook.
 */
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
    const miniclawDir = process.argv[2];
    const payloadStr = process.argv[3];
    
    if (!miniclawDir || !payloadStr) {
        return; 
    }

    try {
        const payload = JSON.parse(payloadStr);
        const filename = payload.filename;
        if (!filename) return;

        const filePath = path.join(miniclawDir, filename);
        const content = await fs.readFile(filePath, "utf-8");

        // We output a reflex suggestion to the LLM
        const instruction = `
🚨 REFLEX TRIGGERED: A new file "${filename}" was created.
ACTION: I've detected this file and summarized it as: "${content.substring(0, 50)}..."
SUGGESTION: Please reflect on whether this file should be linked to an existing Entity or if it defines a new Concept. 
Update REFLECTION.md if necessary.
`;
        console.log(instruction);
    } catch (e) {
        // Fail silently for reflexes
    }
}

main().catch(() => {});
