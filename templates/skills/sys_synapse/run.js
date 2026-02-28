/**
 * sys_synapse: Cognitive Compression Logic
 * This script identifies large memory files and proposes a hierarchical reorganization.
 */

const fs = require('fs');
const path = require('path');

const MINICLAW_DIR = process.env.MINICLAW_DIR || path.join(process.env.HOME, '.miniclaw');

async function run() {
    console.log("🌌 Starting Synaptic Compression...");

    const memoryPath = path.join(MINICLAW_DIR, "MEMORY.md");
    const conceptsPath = path.join(MINICLAW_DIR, "CONCEPTS.md");

    let status = "";
    try {
        const stats = fs.statSync(memoryPath);
        if (stats.size > 5000) status += `\n- MEMORY.md is large (${stats.size} chars). Focus on distilling old Phase history into summaries.`;
    } catch {}

    try {
        const stats = fs.statSync(conceptsPath);
        if (stats.size > 3000) status += `\n- CONCEPTS.md is dense (${stats.size} chars). Suggest hierarchical grouping for related domains.`;
    } catch {}

    const prompt = `
I am triggering a "Synaptic Folding" event. 
Your context is currently under high pressure. ${status}

TASK:
1. Read MEMORY.md and CONCEPTS.md.
2. Identify lists longer than 20 items or sections that focus on completed "Phase" history.
3. Propose a HIERARCHICAL version:
   - Example: Instead of 10 separate "Skill" entries, create a single "Evolution: Skills" section with a comma-separated list.
4. If you identify large blocks of text, summarize them into a single <b>Bold Summary</b>.
5. In the frontmatter of the updated files, set "folded: true".

OUTPUT in the following format:
[REWRITE_FILE: path/to/file]
(New Content)
[END_REWRITE]
`;

    console.log(prompt);
}

run().catch(err => {
    console.error("Synapse failed:", err);
    process.exit(1);
});
