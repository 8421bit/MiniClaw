/**
 * MiniClaw Utils Tests
 */

import { describe, it, expect } from "vitest";
import { matchCronField, cronMatchesNow, parseFrontmatter, fuzzyScore } from "../src/utils.js";

describe("Cron Utils", () => {
    it("matchCronField: wildcard matches any value", () => {
        expect(matchCronField("*", 0, 59)).toBe(true);
        expect(matchCronField("*", 30, 59)).toBe(true);
        expect(matchCronField("*", 59, 59)).toBe(true);
    });

    it("matchCronField: exact number match", () => {
        expect(matchCronField("30", 30, 59)).toBe(true);
        expect(matchCronField("30", 31, 59)).toBe(false);
    });

    it("matchCronField: range match", () => {
        expect(matchCronField("10-20", 15, 59)).toBe(true);
        expect(matchCronField("10-20", 5, 59)).toBe(false);
        expect(matchCronField("10-20", 25, 59)).toBe(false);
    });

    it("matchCronField: step match", () => {
        expect(matchCronField("*/15", 0, 59)).toBe(true);
        expect(matchCronField("*/15", 15, 59)).toBe(true);
        expect(matchCronField("*/15", 30, 59)).toBe(true);
        expect(matchCronField("*/15", 7, 59)).toBe(false);
    });

    it("cronMatchesNow: basic matching", () => {
        const now = new Date("2026-02-27T14:30:00");
        expect(cronMatchesNow("30 14 * * *", now)).toBe(true);
        expect(cronMatchesNow("0 14 * * *", now)).toBe(false);
    });
});

describe("Frontmatter Parser", () => {
    it("parses simple YAML frontmatter", () => {
        const content = `---
name: test
description: A test file
boot-priority: 10
---
# Content here`;
        const result = parseFrontmatter(content);
        expect(result.name).toBe("test");
        expect(result.description).toBe("A test file");
        expect(result["boot-priority"]).toBe("10");
    });

    it("returns empty object for no frontmatter", () => {
        const content = "# Just a markdown file";
        const result = parseFrontmatter(content);
        expect(result).toEqual({});
    });
});

describe("Fuzzy Score", () => {
    it("exact match returns 100", () => {
        expect(fuzzyScore("hello world", "hello world")).toBe(100);
    });

    it("partial match returns proportional score", () => {
        const score = fuzzyScore("the quick brown fox", "quick fox");
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(100);
    });

    it("no match returns 0", () => {
        expect(fuzzyScore("hello world", "xyz")).toBe(0);
    });
});
