import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContextKernel, resolveSkillDirPath, resolveSkillScriptPath } from "../src/kernel.js";

describe("Skill script path resolution", () => {
    it("allows scripts inside a skill directory", () => {
        const skillsDir = path.join(os.tmpdir(), "miniclaw-skills");
        const resolved = resolveSkillScriptPath("demo", "run.js", skillsDir);

        expect(resolved.skillDir).toBe(path.join(skillsDir, "demo"));
        expect(resolved.scriptPath).toBe(path.join(skillsDir, "demo", "run.js"));
    });

    it("rejects skillName traversal outside the skills directory", () => {
        const skillsDir = path.join(os.tmpdir(), "miniclaw-skills");

        expect(() => resolveSkillScriptPath("../../../../etc", "passwd", skillsDir))
            .toThrow("Security violation");
    });

    it("rejects the skills root itself as a skill directory target", () => {
        const skillsDir = path.join(os.tmpdir(), "miniclaw-skills");

        expect(() => resolveSkillDirPath(".", skillsDir)).toThrow("Security violation");
    });

    it("rejects scriptFile traversal outside its skill directory", () => {
        const skillsDir = path.join(os.tmpdir(), "miniclaw-skills");

        expect(() => resolveSkillScriptPath("demo", "../other/run.js", skillsDir))
            .toThrow("Security violation");
    });

    it("blocks the reported executeSkillScript traversal pattern before filesystem access", async () => {
        const kernel = new ContextKernel();

        await expect(kernel.executeSkillScript("../../../../etc", "passwd", {}))
            .resolves.toContain("Security violation");
    });
});
