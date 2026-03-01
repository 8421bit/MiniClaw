/**
 * Shared utility functions for MiniClaw.
 * Kept minimal: only pure functions used by multiple modules.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";

// ─── Cron ────────────────────────────────────────────────────────────────────

export function matchCronField(fieldExpr: string, value: number, max: number): boolean {
    if (fieldExpr === "*") return true;
    for (const part of fieldExpr.split(",")) {
        if (part.includes("/")) {
            const [rangeStr, stepStr] = part.split("/");
            const step = parseInt(stepStr, 10);
            if (isNaN(step) || step <= 0) continue;
            let [start, end] = rangeStr === "*" ? [0, max] : rangeStr.includes("-") ? rangeStr.split("-").map(Number) : [parseInt(rangeStr, 10), max];
            for (let i = start; i <= end; i += step) { if (i === value) return true; }
        } else if (part.includes("-")) {
            const [s, e] = part.split("-").map(Number);
            if (value >= s && value <= e) return true;
        } else if (parseInt(part, 10) === value) return true;
    }
    return false;
}

export function cronMatchesNow(expr: string, now: Date): boolean {
    const f = expr.trim().split(/\s+/);
    if (f.length < 5) return false;
    return matchCronField(f[0], now.getMinutes(), 59) && matchCronField(f[1], now.getHours(), 23) &&
        matchCronField(f[2], now.getDate(), 31) && matchCronField(f[3], now.getMonth() + 1, 12) &&
        matchCronField(f[4], now.getDay(), 6);
}

export function getNowInTz(tz?: string): Date {
    if (!tz) return new Date();
    try { return new Date(new Date().toLocaleString("en-US", { timeZone: tz })); }
    catch { return new Date(); }
}

// ─── Frontmatter ─────────────────────────────────────────────────────────────

export function parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};

    const fmText = match[1].trim();
    if (fmText.startsWith('{') && fmText.endsWith('}')) {
        try { return JSON.parse(fmText); } catch (e) { console.error(`[MiniClaw] Failed to parse frontmatter JSON: ${e}`); }
    }

    const lines = match[1].split('\n');
    const result: Record<string, unknown> = {};
    const stack: { obj: Record<string, unknown>; indent: number; key?: string }[] = [{ obj: result, indent: -1 }];

    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        
        const indent = line.search(/\S/);
        const trimmed = line.trim();

        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
            stack.pop();
        }

        const current = stack[stack.length - 1];

        if (trimmed.startsWith('- ')) {
            if (!Array.isArray(current.obj)) continue; 
            const val = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '');
            const kvMatch = val.match(/^([\w-]+):\s*(.*)$/);
            // Treat as object-in-array only if it starts with 'name', 'id', or 'prompt'
            if (kvMatch && (kvMatch[1] === 'name' || kvMatch[1] === 'id' || kvMatch[1] === 'prompt')) {
                 current.obj.push({ [kvMatch[1]]: kvMatch[2].trim().replace(/^['"]|['"]$/g, '') });
            } else {
                 current.obj.push(val);
            }
            continue;
        }

        const kv = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (kv) {
            const key = kv[1];
            const val = kv[2].trim().replace(/^['"]|['"]$/g, '');

            if (val || trimmed.endsWith(': " "') || trimmed.endsWith(": ''")) {
                if (Array.isArray(current.obj)) {
                    const last = current.obj[current.obj.length - 1];
                    if (typeof last === 'object' && last !== null && !Array.isArray(last) && indent > current.indent) {
                         last[key] = val;
                    } else {
                         current.obj.push(val);
                    }
                } else {
                    result[key] = val; // Flatten for compatibility
                    current.obj[key] = val;
                }
            } else {
                const isArrayKey = ['tools', 'prompts', 'hooks', 'trigger'].includes(key);
                const container = (key === 'metadata') ? {} : (isArrayKey ? [] : {});
                current.obj[key] = container;
                stack.push({ obj: container, indent: indent, key: key });
            }
        }
    }
    return result;
}

// ─── File I/O ────────────────────────────────────────────────────────────────

export async function atomicWrite(filePath: string, data: string): Promise<void> {
    const tmp = filePath + ".tmp";
    await fs.writeFile(tmp, data, "utf-8");
    await fs.rename(tmp, filePath);
}

/** Sleep utility for retry delays */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Safe write with retry logic and exponential backoff */
export async function safeWrite(filePath: string, data: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await atomicWrite(filePath, data);
            return;
        } catch (e) {
            if (i === retries - 1) throw e;
            const delay = 100 * Math.pow(2, i); // Exponential backoff: 100ms, 200ms, 400ms
            console.error(`[MiniClaw] Write retry ${i + 1}/${retries} for ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
            await sleep(delay);
        }
    }
}

export function hashString(s: string): string {
    return crypto.createHash("md5").update(s).digest("hex");
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Simple keyword-based relevance scoring (0-100). */
export function fuzzyScore(line: string, query: string): number {
    const lo = line.toLowerCase(), qo = query.toLowerCase();
    if (lo.includes(qo)) return 100;
    const kws = qo.split(/\s+/).filter(w => w.length > 1);
    if (!kws.length) return 0;
    const matched = kws.filter(k => lo.includes(k)).length;
    return matched ? Math.round((matched / kws.length) * 80) : 0;
}
