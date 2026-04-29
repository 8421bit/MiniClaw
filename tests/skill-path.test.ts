import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { ContextKernel, executeResolvedSkillScript, resolveSkillDirPath, resolveSkillScriptPath } from "../src/kernel.js";

const cleanupPaths: string[] = [];

async function exists(filePath: string): Promise<boolean> {
    return access(filePath).then(() => true, () => false);
}

afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map(p => rm(p, { recursive: true, force: true })));
});

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

    it("passes skill args without shell expansion", async () => {
        const skillsRoot = await mkdtemp(path.join(os.tmpdir(), "miniclaw-skills-"));
        cleanupPaths.push(skillsRoot);
        const skillDir = path.join(skillsRoot, "issue6");
        await mkdir(skillDir);

        const argFile = path.join(os.tmpdir(), `miniclaw-arg-${Date.now()}.json`);
        const marker = path.join(os.tmpdir(), `miniclaw-injection-${Date.now()}`);
        cleanupPaths.push(argFile, marker);

        const script = [
            "import { writeFileSync } from 'node:fs';",
            "writeFileSync(process.env.MINICLAW_TEST_ARG_FILE, process.argv[2] || '');",
            "console.log('ok');",
            "",
        ].join("\n");
        await writeFile(path.join(skillDir, "run.js"), script, "utf-8");

        const originalArgFile = process.env.MINICLAW_TEST_ARG_FILE;
        process.env.MINICLAW_TEST_ARG_FILE = argFile;
        try {
            const payload = `'; touch ${marker}; echo '`;
            await expect(executeResolvedSkillScript(skillDir, path.join(skillDir, "run.js"), { payload }))
                .resolves.toContain("ok");

            expect(await exists(marker)).toBe(false);
            expect(JSON.parse(await readFile(argFile, "utf-8"))).toEqual({ payload });
        } finally {
            if (originalArgFile === undefined) {
                delete process.env.MINICLAW_TEST_ARG_FILE;
            } else {
                process.env.MINICLAW_TEST_ARG_FILE = originalArgFile;
            }
        }
    });
});
