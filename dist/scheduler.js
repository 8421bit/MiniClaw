#!/usr/bin/env node
/**
 * MiniClaw Cron Scheduler (独立脚本)
 *
 * 功能：由 macOS crontab 每分钟调用一次。
 * 读取 ~/.miniclaw/jobs.json，检查哪些任务到期，
 * 将到期任务的 payload 注入 HEARTBEAT.md。
 *
 * 用法：
 *   crontab -e
 *   * * * * * /usr/local/bin/node /path/to/miniclaw/dist/scheduler.js
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// ─── Paths ───────────────────────────────────────────────────────────────────
const MINICLAW_DIR = path.join(os.homedir(), ".miniclaw");
const JOBS_FILE = path.join(MINICLAW_DIR, "jobs.json");
const HEARTBEAT_FILE = path.join(MINICLAW_DIR, "HEARTBEAT.md");
const SCHEDULER_STATE = path.join(MINICLAW_DIR, "scheduler_state.json");
// ─── Cron Expression Matcher ─────────────────────────────────────────────────
// Handles: *, specific numbers, comma lists, ranges (e.g. 1-5), steps (e.g. */5)
function matchCronField(fieldExpr, value, max) {
    if (fieldExpr === "*")
        return true;
    const parts = fieldExpr.split(",");
    for (const part of parts) {
        // Handle step: */5 or 1-10/2
        if (part.includes("/")) {
            const [rangeStr, stepStr] = part.split("/");
            const step = parseInt(stepStr, 10);
            if (isNaN(step) || step <= 0)
                continue;
            let start = 0;
            let end = max;
            if (rangeStr !== "*") {
                if (rangeStr.includes("-")) {
                    const [s, e] = rangeStr.split("-").map(Number);
                    start = s;
                    end = e;
                }
                else {
                    start = parseInt(rangeStr, 10);
                    end = max;
                }
            }
            for (let i = start; i <= end; i += step) {
                if (i === value)
                    return true;
            }
            continue;
        }
        // Handle range: 1-5
        if (part.includes("-")) {
            const [start, end] = part.split("-").map(Number);
            if (value >= start && value <= end)
                return true;
            continue;
        }
        // Handle exact number
        if (parseInt(part, 10) === value)
            return true;
    }
    return false;
}
function cronMatchesNow(expr, now) {
    const fields = expr.trim().split(/\s+/);
    if (fields.length < 5) {
        console.error(`[Scheduler] Invalid cron expression (need 5 fields): "${expr}"`);
        return false;
    }
    const [minuteExpr, hourExpr, dayExpr, monthExpr, dowExpr] = fields;
    const minute = now.getMinutes();
    const hour = now.getHours();
    const day = now.getDate();
    const month = now.getMonth() + 1; // JS months are 0-indexed
    const dow = now.getDay(); // 0=Sunday
    return (matchCronField(minuteExpr, minute, 59) &&
        matchCronField(hourExpr, hour, 23) &&
        matchCronField(dayExpr, day, 31) &&
        matchCronField(monthExpr, month, 12) &&
        matchCronField(dowExpr, dow, 6));
}
/** Convert current time to a specific timezone using Intl API */
function getNowInTz(tz) {
    if (!tz)
        return new Date();
    try {
        const str = new Date().toLocaleString("en-US", { timeZone: tz });
        return new Date(str);
    }
    catch {
        console.error(`[Scheduler] Invalid timezone "${tz}", falling back to local time`);
        return new Date();
    }
}
// ─── State Management ────────────────────────────────────────────────────────
async function loadState() {
    try {
        const raw = await fs.readFile(SCHEDULER_STATE, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return { lastRuns: {} };
    }
}
async function saveState(state) {
    await fs.writeFile(SCHEDULER_STATE, JSON.stringify(state, null, 2), "utf-8");
}
// ─── Heartbeat Injection ─────────────────────────────────────────────────────
async function injectHeartbeat(job, now) {
    const timestamp = now.toISOString().replace("T", " ").substring(0, 19);
    const header = `\n\n---\n## 🔔 Scheduled: ${job.name} (${timestamp})\n`;
    const body = `${job.payload.text}\n`;
    await fs.appendFile(HEARTBEAT_FILE, header + body, "utf-8");
    console.error(`[Scheduler] ✅ Injected job "${job.name}" into HEARTBEAT.md`);
}
// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    // 1. Load jobs
    let jobs;
    try {
        const raw = await fs.readFile(JOBS_FILE, "utf-8");
        jobs = JSON.parse(raw);
    }
    catch (e) {
        // No jobs file = nothing to do
        console.error(`[Scheduler] No jobs.json found or invalid: ${e}`);
        return;
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
        return; // No jobs defined
    }
    // 2. Load state (deduplication)
    const state = await loadState();
    const now = new Date();
    const currentMinuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    let triggered = 0;
    // 3. Check each job
    for (const job of jobs) {
        if (!job.enabled)
            continue;
        if (job.schedule?.kind !== "cron" || !job.schedule.expr)
            continue;
        // Deduplicate: skip if already ran this minute
        if (state.lastRuns[job.id] === currentMinuteKey)
            continue;
        // Match cron expression against current time (timezone-aware)
        const jobNow = getNowInTz(job.schedule.tz);
        if (cronMatchesNow(job.schedule.expr, jobNow)) {
            await injectHeartbeat(job, now);
            state.lastRuns[job.id] = currentMinuteKey;
            triggered++;
        }
    }
    // 4. Save state
    if (triggered > 0) {
        await saveState(state);
        console.error(`[Scheduler] ${triggered} job(s) triggered.`);
    }
}
main().catch((e) => {
    console.error(`[Scheduler] Fatal error: ${e}`);
    process.exit(1);
});
