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
import { cronMatchesNow, getNowInTz } from "./utils.js";

// ─── Paths ───────────────────────────────────────────────────────────────────

const MINICLAW_DIR = path.join(os.homedir(), ".miniclaw");
const JOBS_FILE = path.join(MINICLAW_DIR, "jobs.json");
const HEARTBEAT_FILE = path.join(MINICLAW_DIR, "HEARTBEAT.md");
const SCHEDULER_STATE = path.join(MINICLAW_DIR, "scheduler_state.json");

// ─── Types ───────────────────────────────────────────────────────────────────

interface Job {
    id: string;
    name: string;
    enabled: boolean;
    schedule: { kind: "cron"; expr: string; tz?: string; };
    payload: { kind: "systemEvent"; text: string; };
    createdAtMs?: number;
    updatedAtMs?: number;
}

interface SchedulerState {
    lastRuns: Record<string, string>;
}

// ─── State ───────────────────────────────────────────────────────────────────

async function loadState(): Promise<SchedulerState> {
    try { return JSON.parse(await fs.readFile(SCHEDULER_STATE, "utf-8")); }
    catch { return { lastRuns: {} }; }
}

async function saveState(state: SchedulerState): Promise<void> {
    await fs.writeFile(SCHEDULER_STATE, JSON.stringify(state, null, 2), "utf-8");
}

// ─── Heartbeat Injection ─────────────────────────────────────────────────────

async function injectHeartbeat(job: Job, now: Date): Promise<void> {
    const ts = now.toISOString().replace("T", " ").substring(0, 19);
    const marker = `<!-- job:${job.id} -->`;
    
    // Check if already injected (prevent duplicates in HEARTBEAT.md)
    const existing = await fs.readFile(HEARTBEAT_FILE, "utf-8").catch(() => "");
    if (existing.includes(marker)) {
        console.error(`[Scheduler] ⚠️ Job "${job.name}" already in heartbeat, skipping`);
        return;
    }
    
    await fs.appendFile(HEARTBEAT_FILE, `\n\n---\n## 🔔 Scheduled: ${job.name} (${ts})\n${marker}\n${job.payload.text}\n`, "utf-8");
    console.error(`[Scheduler] ✅ Injected "${job.name}"`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // 1. Load jobs
    let jobs: Job[];
    try {
        const raw = await fs.readFile(JOBS_FILE, "utf-8");
        jobs = JSON.parse(raw);
    } catch (e) {
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
        if (!job.enabled) continue;
        if (job.schedule?.kind !== "cron" || !job.schedule.expr) continue;

        // Deduplicate: skip if already ran this minute
        if (state.lastRuns[job.id] === currentMinuteKey) continue;

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
