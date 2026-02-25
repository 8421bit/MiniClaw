/**
 * Shared utility functions for MiniClaw.
 * Extracted for testability.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";

// ─── Cron Expression Matcher ─────────────────────────────────────────────────

export function matchCronField(fieldExpr: string, value: number, max: number): boolean {
    if (fieldExpr === "*") return true;

    const parts = fieldExpr.split(",");
    for (const part of parts) {
        if (part.includes("/")) {
            const [rangeStr, stepStr] = part.split("/");
            const step = parseInt(stepStr, 10);
            if (isNaN(step) || step <= 0) continue;

            let start = 0;
            let end = max;
            if (rangeStr !== "*") {
                if (rangeStr.includes("-")) {
                    const [s, e] = rangeStr.split("-").map(Number);
                    start = s;
                    end = e;
                } else {
                    start = parseInt(rangeStr, 10);
                    end = max;
                }
            }
            for (let i = start; i <= end; i += step) {
                if (i === value) return true;
            }
            continue;
        }

        if (part.includes("-")) {
            const [start, end] = part.split("-").map(Number);
            if (value >= start && value <= end) return true;
            continue;
        }

        if (parseInt(part, 10) === value) return true;
    }
    return false;
}

export function cronMatchesNow(expr: string, now: Date): boolean {
    const fields = expr.trim().split(/\s+/);
    if (fields.length < 5) return false;

    const [minuteExpr, hourExpr, dayExpr, monthExpr, dowExpr] = fields;
    return (
        matchCronField(minuteExpr, now.getMinutes(), 59) &&
        matchCronField(hourExpr, now.getHours(), 23) &&
        matchCronField(dayExpr, now.getDate(), 31) &&
        matchCronField(monthExpr, now.getMonth() + 1, 12) &&
        matchCronField(dowExpr, now.getDay(), 6)
    );
}

export function getNowInTz(tz?: string): Date {
    if (!tz) return new Date();
    try {
        const str = new Date().toLocaleString("en-US", { timeZone: tz });
        return new Date(str);
    } catch {
        return new Date();
    }
}

// ─── Frontmatter Parser ─────────────────────────────────────────────────────

export function parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result: Record<string, unknown> = {};
    const lines = match[1].split('\n');
    let currentKey = '';
    let inArray = false;
    let arrayItems: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('- ') && inArray) {
            arrayItems.push(trimmed.slice(2).trim());
            continue;
        }
        if (inArray && currentKey) {
            result[currentKey] = arrayItems;
            inArray = false;
            arrayItems = [];
        }
        const kvMatch = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            const value = kvMatch[2].trim().replace(/^['"]|['"]$/g, '');
            if (!value) {
                inArray = true;
                arrayItems = [];
            } else {
                result[currentKey] = value;
            }
        }
    }
    if (inArray && currentKey) {
        result[currentKey] = arrayItems;
    }
    return result;
}

// ─── Atomic Write ────────────────────────────────────────────────────────────

export async function atomicWrite(filePath: string, data: string): Promise<void> {
    const tmp = filePath + ".tmp";
    await fs.writeFile(tmp, data, "utf-8");
    await fs.rename(tmp, filePath);
}

// ─── Hash ────────────────────────────────────────────────────────────────────

export function hashString(s: string): string {
    return crypto.createHash("md5").update(s).digest("hex");
}

// ─── File Lock (Advisory) ────────────────────────────────────────────────────

const LOCK_TIMEOUT_MS = 5000;

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
    const lockFile = lockPath + ".lock";
    const start = Date.now();

    // Spin until lock acquired or timeout
    while (true) {
        try {
            await fs.writeFile(lockFile, String(process.pid), { flag: "wx" });
            break; // acquired
        } catch {
            if (Date.now() - start > LOCK_TIMEOUT_MS) {
                // Force-break stale lock
                try { await fs.unlink(lockFile); } catch { }
                continue;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    }

    try {
        return await fn();
    } finally {
        try { await fs.unlink(lockFile); } catch { }
    }
}

// ─── Fuzzy Search Scoring ────────────────────────────────────────────────────

export interface FuzzyMatch {
    file: string;
    line: number;
    content: string;
    score: number;
}

/**
 * Score a line against a query using keyword matching.
 * Returns 0 for no match, higher for better matches.
 */
export function fuzzyScore(line: string, query: string): number {
    const normalizedLine = line.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    // Exact substring match: highest score
    if (normalizedLine.includes(normalizedQuery)) return 100;

    // Keyword matching: split query into words and count matches
    const keywords = normalizedQuery.split(/\s+/).filter(w => w.length > 1);
    if (keywords.length === 0) return 0;

    let matched = 0;
    for (const kw of keywords) {
        if (normalizedLine.includes(kw)) matched++;
    }

    if (matched === 0) return 0;
    return Math.round((matched / keywords.length) * 80); // max 80 for partial match
}
