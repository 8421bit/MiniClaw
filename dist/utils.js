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
        if (part.includes("/")) {
            const [rangeStr, stepStr] = part.split("/");
            const step = parseInt(stepStr, 10);
            if (isNaN(step) || step <= 0)
                continue;
            let [start, end] = rangeStr === "*" ? [0, max] : rangeStr.includes("-") ? rangeStr.split("-").map(Number) : [parseInt(rangeStr, 10), max];
            for (let i = start; i <= end; i += step) {
                if (i === value)
                    return true;
            }
        }
        else if (part.includes("-")) {
            const [s, e] = part.split("-").map(Number);
            if (value >= s && value <= e)
                return true;
        }
        else if (parseInt(part, 10) === value)
            return true;
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
export function getNowInTz(tz) {
    if (!tz)
        return new Date();
    try {
        return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    }
    catch {
        return new Date();
    }
}
// ─── Frontmatter ─────────────────────────────────────────────────────────────
export function parseFrontmatter(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match)
        return {};
    const result = {};
    let currentKey = '', inArray = false, arrayItems = [];
    for (const line of match[1].split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        if (trimmed.startsWith('- ') && inArray) {
            arrayItems.push(trimmed.slice(2).trim());
            continue;
        }
        if (inArray && currentKey) {
            result[currentKey] = arrayItems;
            inArray = false;
            arrayItems = [];
        }
        const kv = trimmed.match(/^([\w-]+):\s*(.*)$/);
        if (kv) {
            currentKey = kv[1];
            const v = kv[2].trim().replace(/^['"]|['"]$/g, '');
            if (!v) {
                inArray = true;
                arrayItems = [];
            }
            else {
                result[currentKey] = v;
            }
        }
    }
    if (inArray && currentKey)
        result[currentKey] = arrayItems;
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
// ─── Search ──────────────────────────────────────────────────────────────────
/** Simple keyword-based relevance scoring (0-100). */
export function fuzzyScore(line, query) {
    const lo = line.toLowerCase(), qo = query.toLowerCase();
    if (lo.includes(qo))
        return 100;
    const kws = qo.split(/\s+/).filter(w => w.length > 1);
    if (!kws.length)
        return 0;
    const matched = kws.filter(k => lo.includes(k)).length;
    return matched ? Math.round((matched / kws.length) * 80) : 0;
}
