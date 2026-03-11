/**
 * Shared utility functions for MiniClaw.
 * Kept minimal: only pure functions used by multiple modules.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";

// ─── Frontmatter ─────────────────────────────────────────────────────────────

// #11: Hand-rolled YAML parser to maintain zero-dependency policy (no `yaml` or `js-yaml` lib).
// Supports flat key-value, arrays, and nested objects — sufficient for SKILL.md frontmatter.
export function parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};

    const fmText = match[1].trim();

    // JSON frontmatter
    if (fmText.startsWith('{') && fmText.endsWith('}')) {
        try { return JSON.parse(fmText); } catch (e) {
            console.error(`[MiniClaw] Failed to parse frontmatter JSON: ${e}`);
            return {};
        }
    }

    // YAML frontmatter
    const lines = match[1].split('\n');
    const result: Record<string, unknown> = {};
    const stack: Array<{ obj: Record<string, unknown> | unknown[]; indent: number; key?: string }> = [{ obj: result, indent: -1 }];
    const ARRAY_KEYS = new Set(['tools', 'prompts', 'hooks', 'trigger']);
    const OBJECT_IN_ARRAY_KEYS = new Set(['name', 'id', 'prompt']);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const indent = line.search(/\S/);

        // Pop stack to correct nesting level
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
            stack.pop();
        }

        const current = stack[stack.length - 1];

        // Array item
        if (trimmed.startsWith('- ')) {
            if (!Array.isArray(current.obj)) continue;

            const val = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '');
            const kvMatch = val.match(/^([\w-]+):\s*(.*)$/);

            if (kvMatch && OBJECT_IN_ARRAY_KEYS.has(kvMatch[1])) {
                current.obj.push({ [kvMatch[1]]: kvMatch[2].trim().replace(/^['"]|['"]$/g, '') });
            } else {
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
                        (last as Record<string, unknown>)[key] = val;
                    } else {
                        current.obj.push(val);
                    }
                } else {
                    result[key] = val;
                    (current.obj as Record<string, unknown>)[key] = val;
                }
            }
            // No value (nested object or array)
            else {
                const container = key === 'metadata'
                    ? {}
                    : ARRAY_KEYS.has(key) ? [] : {};

                (current.obj as Record<string, unknown>)[key] = container;
                stack.push({ obj: container, indent, key });
            }
        }
    }

    return result;
}

// ─── File I/O ────────────────────────────────────────────────────────────────

export async function atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, filePath);
}

export const safeRead = async (p: string, defaultValue = ""): Promise<string> => {
    try { return await fs.readFile(p, "utf-8"); } catch { return defaultValue; }
};

export const safeReadJson = async <T>(p: string, defaultValue: T): Promise<T> => {
    try { return JSON.parse(await fs.readFile(p, "utf-8")) as T; } catch { return defaultValue; }
};

export const safeWrite = async (p: string, data: string): Promise<void> => {
    try { await fs.writeFile(p, data, "utf-8"); } catch { /* ignore */ }
};

export const safeAppend = async (p: string, data: string): Promise<void> => {
    try { await fs.appendFile(p, data, "utf-8"); } catch { /* ignore */ }
};

export const fileExists = (p: string) => fs.access(p).then(() => true, () => false);

export function hashString(s: string): string {
    return crypto.createHash("md5").update(s).digest("hex");
}

// ─── Math & Logic ────────────────────────────────────────────────────────────

export function calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase(), s2 = str2.toLowerCase();
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;
    const pairs1 = getPairs(s1), pairs2 = getPairs(s2);
    let hit = 0, union = pairs1.length + pairs2.length;
    for (const p1 of pairs1) {
        const idx = pairs2.indexOf(p1);
        if (idx !== -1) { hit++; pairs2.splice(idx, 1); }
    }
    return (2.0 * hit) / union;
}

const getPairs = (s: string) => {
    const p = [];
    for (let i = 0; i < s.length - 1; i++) p.push(s.substring(i, i + 2));
    return p;
};

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const blend = (curr: number, target: number, rate = 0.3) => curr + (target - curr) * rate;

// ─── Time ────────────────────────────────────────────────────────────────────

export const pick = <T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
    const res = {} as any;
    for (const k of keys) if (obj[k] !== undefined) res[k] = obj[k];
    return res;
};

export const today = () => new Date().toISOString().split('T')[0];
export const nowIso = () => new Date().toISOString();
export const daysSince = (t: string | number | Date) => (Date.now() - new Date(t).getTime()) / 86400000;
export const hoursSince = (t: string | number | Date) => (Date.now() - new Date(t).getTime()) / 3600000;

// ─── MCP Helpers ──────────────────────────────────────────────────────────────

export const textResult = (text: string, isError = false) => ({
    content: [{ type: "text" as const, text }],
    ...(isError && { isError: true })
});
export const errorResult = (msg: string) => textResult(`❌ ${msg}`, true);
