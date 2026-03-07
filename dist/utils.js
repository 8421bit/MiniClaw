/**
 * Shared utility functions for MiniClaw.
 * Kept minimal: only pure functions used by multiple modules.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
// ─── Cron ────────────────────────────────────────────────────────────────────
export function matchCronField(fieldExpr, value, max) {
    if (fieldExpr === "*")
        return true;
    for (const part of fieldExpr.split(",")) {
        // Range with step: "*/2", "1-10/3"
        if (part.includes("/")) {
            const [rangeStr, stepStr] = part.split("/");
            const step = parseInt(stepStr, 10);
            if (isNaN(step) || step <= 0)
                continue;
            const [start, end] = rangeStr === "*"
                ? [0, max]
                : rangeStr.includes("-")
                    ? rangeStr.split("-").map(Number)
                    : [parseInt(rangeStr, 10), max];
            for (let i = start; i <= end; i += step) {
                if (i === value)
                    return true;
            }
        }
        // Range: "1-5"
        else if (part.includes("-")) {
            const [s, e] = part.split("-").map(Number);
            if (value >= s && value <= e)
                return true;
        }
        // Single value: "5"
        else if (parseInt(part, 10) === value) {
            return true;
        }
    }
    return false;
}
export function cronMatchesNow(expr, now) {
    const f = expr.trim().split(/\s+/);
    if (f.length < 5)
        return false;
    return matchCronField(f[0], now.getMinutes(), 59) && matchCronField(f[1], now.getHours(), 23) &&
        matchCronField(f[2], now.getDate(), 31) && matchCronField(f[3], now.getMonth() + 1, 12) &&
        matchCronField(f[4], now.getDay(), 6);
}
// ─── Frontmatter ─────────────────────────────────────────────────────────────
// #11: Hand-rolled YAML parser to maintain zero-dependency policy (no `yaml` or `js-yaml` lib).
// Supports flat key-value, arrays, and nested objects — sufficient for SKILL.md frontmatter.
export function parseFrontmatter(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match)
        return {};
    const fmText = match[1].trim();
    // JSON frontmatter
    if (fmText.startsWith('{') && fmText.endsWith('}')) {
        try {
            return JSON.parse(fmText);
        }
        catch (e) {
            console.error(`[MiniClaw] Failed to parse frontmatter JSON: ${e}`);
            return {};
        }
    }
    // YAML frontmatter
    const lines = match[1].split('\n');
    const result = {};
    const stack = [{ obj: result, indent: -1 }];
    const ARRAY_KEYS = new Set(['tools', 'prompts', 'hooks', 'trigger']);
    const OBJECT_IN_ARRAY_KEYS = new Set(['name', 'id', 'prompt']);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const indent = line.search(/\S/);
        // Pop stack to correct nesting level
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
            stack.pop();
        }
        const current = stack[stack.length - 1];
        // Array item
        if (trimmed.startsWith('- ')) {
            if (!Array.isArray(current.obj))
                continue;
            const val = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '');
            const kvMatch = val.match(/^([\w-]+):\s*(.*)$/);
            if (kvMatch && OBJECT_IN_ARRAY_KEYS.has(kvMatch[1])) {
                current.obj.push({ [kvMatch[1]]: kvMatch[2].trim().replace(/^['"]|['"]$/g, '') });
            }
            else {
                current.obj.push(val);
            }
            continue;
        }
        // Key-value pair
        const kv = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (kv) {
            const key = kv[1];
            const val = kv[2].trim().replace(/^['"]|['"]$/g, '');
            // Has value (string)
            if (val || trimmed.endsWith(': " "') || trimmed.endsWith(": ''")) {
                if (Array.isArray(current.obj)) {
                    const last = current.obj[current.obj.length - 1];
                    const isNested = typeof last === 'object' && last !== null && !Array.isArray(last) && indent > current.indent;
                    if (isNested) {
                        last[key] = val;
                    }
                    else {
                        current.obj.push(val);
                    }
                }
                else {
                    result[key] = val;
                    current.obj[key] = val;
                }
            }
            // No value (nested object or array)
            else {
                const container = key === 'metadata'
                    ? {}
                    : ARRAY_KEYS.has(key) ? [] : {};
                current.obj[key] = container;
                stack.push({ obj: container, indent, key });
            }
        }
    }
    return result;
}
// ─── File I/O ────────────────────────────────────────────────────────────────
export async function atomicWrite(filePath, data) {
    const tmp = filePath + ".tmp";
    await fs.writeFile(tmp, data, "utf-8");
    await fs.rename(tmp, filePath);
}
export function hashString(s) {
    return crypto.createHash("md5").update(s).digest("hex");
}
// ─── MCP Response Helpers ────────────────────────────────────────────────────
/** Standard MCP text response (eliminates 49+ repetitions) */
export const textResult = (text, isError = false) => ({
    content: [{ type: "text", text }],
    ...(isError && { isError: true })
});
/** Standard MCP error response */
export const errorResult = (msg) => textResult(`❌ ${msg}`);
// ─── Common Helpers ──────────────────────────────────────────────────────────
/** Today's date as YYYY-MM-DD */
export const today = () => new Date().toISOString().split('T')[0];
/** Current timestamp in ISO format */
export const nowIso = () => new Date().toISOString();
/** Current time string HH:MM:SS */
export const currentTime = () => new Date().toLocaleTimeString();
/** Check if a path exists (avoids try/catch boilerplate) */
export const fileExists = (p) => fs.access(p).then(() => true, () => false);
/** Safe file read - returns default value on error */
export const safeRead = async (p, defaultValue = "") => {
    try {
        return await fs.readFile(p, "utf-8");
    }
    catch {
        return defaultValue;
    }
};
/** Safe JSON read - returns default value on error */
export const safeReadJson = async (p, defaultValue) => {
    try {
        return JSON.parse(await fs.readFile(p, "utf-8"));
    }
    catch {
        return defaultValue;
    }
};
/** Safe file write - ignores errors */
export const safeWrite = async (p, data) => {
    try {
        await fs.writeFile(p, data, "utf-8");
    }
    catch { /* ignore */ }
};
/** Safe append - ignores errors */
export const safeAppend = async (p, data) => {
    try {
        await fs.appendFile(p, data, "utf-8");
    }
    catch { /* ignore */ }
};
/** Calculate days since a timestamp */
export const daysSince = (timestamp) => {
    const then = new Date(timestamp).getTime();
    return (Date.now() - then) / (1000 * 60 * 60 * 24);
};
/** Calculate hours since a timestamp */
export const hoursSince = (timestamp) => {
    const then = new Date(timestamp).getTime();
    return (Date.now() - then) / (1000 * 60 * 60);
};
/** Clamp number to range */
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
/** Blend two values (linear interpolation) */
export const blend = (current, target, rate = 0.3) => current + (target - current) * rate;
