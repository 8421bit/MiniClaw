import { describe, it, expect } from "vitest";
import { matchCronField, cronMatchesNow, parseFrontmatter, hashString, getNowInTz } from "../src/utils.js";

// ─── Cron Field Matching ─────────────────────────────────────────────────────

describe("matchCronField", () => {
    it("should match wildcard *", () => {
        expect(matchCronField("*", 0, 59)).toBe(true);
        expect(matchCronField("*", 30, 59)).toBe(true);
    });

    it("should match exact number", () => {
        expect(matchCronField("5", 5, 59)).toBe(true);
        expect(matchCronField("5", 6, 59)).toBe(false);
    });

    it("should match comma-separated values", () => {
        expect(matchCronField("0,15,30,45", 15, 59)).toBe(true);
        expect(matchCronField("0,15,30,45", 10, 59)).toBe(false);
    });

    it("should match ranges", () => {
        expect(matchCronField("1-5", 3, 6)).toBe(true);
        expect(matchCronField("1-5", 6, 6)).toBe(false);
        expect(matchCronField("1-5", 1, 6)).toBe(true);
        expect(matchCronField("1-5", 5, 6)).toBe(true);
    });

    it("should match step values", () => {
        expect(matchCronField("*/5", 0, 59)).toBe(true);
        expect(matchCronField("*/5", 5, 59)).toBe(true);
        expect(matchCronField("*/5", 10, 59)).toBe(true);
        expect(matchCronField("*/5", 3, 59)).toBe(false);
    });

    it("should match range with step", () => {
        expect(matchCronField("0-30/10", 0, 59)).toBe(true);
        expect(matchCronField("0-30/10", 10, 59)).toBe(true);
        expect(matchCronField("0-30/10", 20, 59)).toBe(true);
        expect(matchCronField("0-30/10", 30, 59)).toBe(true);
        expect(matchCronField("0-30/10", 15, 59)).toBe(false);
    });
});

// ─── Full Cron Expression Matching ───────────────────────────────────────────

describe("cronMatchesNow", () => {
    it("should match '* * * * *' at any time", () => {
        expect(cronMatchesNow("* * * * *", new Date())).toBe(true);
    });

    it("should match specific time", () => {
        // Sat Feb 15 2025 21:00:00 (Saturday = dow 6, month = 2)
        const date = new Date(2025, 1, 15, 21, 0, 0); // Month is 0-indexed in JS
        expect(cronMatchesNow("0 21 * * *", date)).toBe(true);
        expect(cronMatchesNow("0 22 * * *", date)).toBe(false);
    });

    it("should match specific day of week", () => {
        // Mon Feb 17 2025 (Monday = dow 1)
        const monday = new Date(2025, 1, 17, 9, 0, 0);
        expect(cronMatchesNow("0 9 * * 1", monday)).toBe(true);
        expect(cronMatchesNow("0 9 * * 0", monday)).toBe(false); // Sunday
    });

    it("should reject invalid expressions", () => {
        expect(cronMatchesNow("0 21", new Date())).toBe(false); // too few fields
    });

    it("should match daily at midnight", () => {
        const midnight = new Date(2025, 5, 1, 0, 0, 0); // June 1
        expect(cronMatchesNow("0 0 * * *", midnight)).toBe(true);
    });
});

// ─── Timezone Conversion ─────────────────────────────────────────────────────

describe("getNowInTz", () => {
    it("should return a Date for valid timezone", () => {
        const result = getNowInTz("Asia/Shanghai");
        expect(result).toBeInstanceOf(Date);
    });

    it("should return local time for undefined tz", () => {
        const before = Date.now();
        const result = getNowInTz(undefined);
        const after = Date.now();
        expect(result.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(result.getTime()).toBeLessThanOrEqual(after + 1000);
    });

    it("should fallback gracefully for invalid timezone", () => {
        const result = getNowInTz("Invalid/Zone");
        expect(result).toBeInstanceOf(Date);
    });
});

// ─── Frontmatter Parser ─────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
    it("should parse simple key-value pairs", () => {
        const input = `---
name: test-skill
description: A test skill
---
# Content here`;
        const result = parseFrontmatter(input);
        expect(result["name"]).toBe("test-skill");
        expect(result["description"]).toBe("A test skill");
    });

    it("should parse arrays", () => {
        const input = `---
name: skill
tags:
- typescript
- mcp
- agent
---`;
        const result = parseFrontmatter(input);
        expect(result["name"]).toBe("skill");
        expect(result["tags"]).toEqual(["typescript", "mcp", "agent"]);
    });

    it("should strip quotes from values", () => {
        const input = `---
name: 'quoted-name'
version: "1.0"
---`;
        const result = parseFrontmatter(input);
        expect(result["name"]).toBe("quoted-name");
        expect(result["version"]).toBe("1.0");
    });

    it("should return empty object for no frontmatter", () => {
        expect(parseFrontmatter("No frontmatter here")).toEqual({});
    });

    it("should skip comments", () => {
        const input = `---
name: test
# This is a comment
version: 2
---`;
        const result = parseFrontmatter(input);
        expect(result["name"]).toBe("test");
        expect(result["version"]).toBe("2");
    });
});

// ─── Hash ────────────────────────────────────────────────────────────────────

describe("hashString", () => {
    it("should return consistent hash for same input", () => {
        const h1 = hashString("hello");
        const h2 = hashString("hello");
        expect(h1).toBe(h2);
    });

    it("should return different hash for different input", () => {
        expect(hashString("hello")).not.toBe(hashString("world"));
    });

    it("should return a 32-char hex string", () => {
        const hash = hashString("test");
        expect(hash).toMatch(/^[a-f0-9]{32}$/);
    });
});
