const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const HOME_DIR = process.env.HOME || process.cwd();
const MINICLAW_DIR = path.join(HOME_DIR, ".miniclaw");

// Hardcoded core files
const coreFiles = ["BOOTSTRAP.md", "HEARTBEAT.md", "SUBAGENT.md", "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"];

async function main() {
    let state = { analytics: {}, heartbeat: {} };
    try {
        const stateRaw = await fs.readFile(path.join(MINICLAW_DIR, "state.json"), "utf-8");
        state = JSON.parse(stateRaw);
    } catch { }

    const hbState = state.heartbeat || {};
    const analytics = state.analytics || { toolCalls: {}, bootCount: 0, totalBootMs: 0 };

    // File sizes
    const fileSizes = [];
    for (const f of coreFiles) {
        try {
            const s = await fs.stat(path.join(MINICLAW_DIR, f));
            fileSizes.push(`  ${f}: ${s.size}B`);
        } catch {
            fileSizes.push(`  ${f}: MISSING`);
        }
    }

    let skillCount = 0;
    try {
        const skillsDir = path.join(MINICLAW_DIR, "skills");
        const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
        skillCount = dirs.filter(d => d.isDirectory()).length;
    } catch { }

    let entityCount = 0;
    try {
        const entData = JSON.parse(await fs.readFile(path.join(MINICLAW_DIR, "entities.json"), "utf-8"));
        entityCount = Object.keys(entData).length;
    } catch { }

    let archivedCount = 0;
    try {
        const archived = await fs.readdir(path.join(MINICLAW_DIR, "memory", "archived"));
        archivedCount = archived.filter(f => f.endsWith('.md')).length;
    } catch { }

    // Top tools
    const topTools = Object.entries(analytics.toolCalls || {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => `${name}(${count})`)
        .join(', ');

    const avgBoot = analytics.bootCount > 0 ? Math.round((analytics.totalBootMs || 0) / analytics.bootCount) : 0;

    const report = [
        `=== 🧠 MiniClaw 1.0 "The Singularity" ===`,
        ``,
        `## System`,
        `Boot count: ${analytics.bootCount} | Avg boot: ${avgBoot}ms`,
        `Last heartbeat: ${hbState.lastHeartbeat || 'never'}`,
        `Last distill: ${hbState.lastDistill || 'never'}`,
        `Needs distill: ${hbState.needsDistill || false}`,
        `Last activity: ${analytics.lastActivity || 'never'}`,
        ``,
        `## Analytics`,
        `Top tools: ${topTools || 'none'}`,
        `Distillations: ${analytics.dailyDistillations || 0}`,
        ``,
        `## Storage`,
        `Skills: ${skillCount} | Entities: ${entityCount} | Archived: ${archivedCount}`,
        `Daily log: ${hbState.dailyLogBytes || 0}B`,
        `Core files:`,
        ...fileSizes,
    ].join('\\n');

    console.log(report);
}

main().catch(e => {
    console.error("Status check failed:", e);
    process.exit(1);
});
