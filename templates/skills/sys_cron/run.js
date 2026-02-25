const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const HOME_DIR = process.env.HOME || process.cwd();
const MINICLAW_DIR = path.join(HOME_DIR, ".miniclaw");
const JOBS_FILE = path.join(MINICLAW_DIR, "jobs.json");

async function main() {
    const action = process.env.INPUT_ACTION || "list";
    const id = process.env.INPUT_ID;
    const jobName = process.env.INPUT_NAME;
    const cronExpr = process.env.INPUT_CRON;
    const text = process.env.INPUT_TEXT;
    const tz = process.env.INPUT_TZ || "Asia/Shanghai";

    let jobs = [];
    try {
        const raw = await fs.readFile(JOBS_FILE, "utf-8");
        jobs = JSON.parse(raw);
        if (!Array.isArray(jobs)) jobs = [];
    } catch { }

    if (action === "list") {
        if (!jobs.length) { console.log("📋 没有定时任务。"); return; }
        const lines = jobs.map((j, i) => `${i + 1}. ${j.enabled ? "✅" : "⏸️"} **${j.name}** — \`${j.schedule?.expr}\` ${j.schedule?.tz ? `(${j.schedule.tz})` : ""}\\n   ID: \`${j.id}\``).join("\\n\\n");
        console.log(`📋 定时任务列表：\\n\\n${lines}`);
        return;
    }

    if (action === "add") {
        if (!jobName || !cronExpr || !text) throw new Error("需要 name, cron, text。");
        const newId = crypto.randomUUID();
        jobs.push({
            id: newId,
            name: jobName,
            enabled: true,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            schedule: { kind: "cron", expr: cronExpr, tz },
            payload: { kind: "systemEvent", text }
        });
        await fs.writeFile(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
        console.log(`✅ 已添加：**${jobName}** (${cronExpr}) ID: \`${newId}\``);
        return;
    }

    if (action === "remove") {
        if (!id) throw new Error("需要 id。");
        const idx = jobs.findIndex(j => j.id === id);
        if (idx === -1) throw new Error(`找不到 ID: ${id}`);
        const [removed] = jobs.splice(idx, 1);
        await fs.writeFile(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
        console.log(`🗑️ 已删除：**${removed.name}**`);
        return;
    }

    if (action === "toggle") {
        if (!id) throw new Error("需要 id。");
        const job = jobs.find(j => j.id === id);
        if (!job) throw new Error(`找不到 ID: ${id}`);
        job.enabled = !job.enabled;
        job.updatedAtMs = Date.now();
        await fs.writeFile(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
        console.log(`${job.enabled ? "✅" : "⏸️"} **${job.name}** 已${job.enabled ? "启用" : "禁用"}`);
        return;
    }

    console.error("Unknown action.");
}

main().catch(e => {
    console.error("❌ " + e.message);
    process.exit(1);
});
