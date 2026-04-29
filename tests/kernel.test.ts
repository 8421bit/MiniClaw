import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    getCognitivePulseCandidates,
    runCognitivePulseCandidate,
    stripPulseRouteTag,
    type CognitivePulseCandidate,
} from "../src/kernel.js";

const tempDirs: string[] = [];

async function exists(filePath: string): Promise<boolean> {
    return access(filePath).then(() => true, () => false);
}

async function makeFakeCli(): Promise<{ dir: string; argvFile: string; stdinFile: string }> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "miniclaw-test-"));
    tempDirs.push(dir);
    const argvFile = path.join(dir, "argv.txt");
    const stdinFile = path.join(dir, "stdin.txt");
    const cliPath = path.join(dir, "fakecli");
    await writeFile(cliPath, [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$MINICLAW_TEST_ARGV\"",
        "cat > \"$MINICLAW_TEST_STDIN\"",
        "printf 'ok\\n'",
        "",
    ].join("\n"));
    await chmod(cliPath, 0o755);
    return { dir, argvFile, stdinFile };
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("Cognitive pulse command execution", () => {
    it("keeps route tags out of the prompt text sent to CLIs", () => {
        expect(stripPulseRouteTag("[@ollama] review this")).toBe("review this");
        expect(getCognitivePulseCandidates("[@claude] review this")[0].name).toBe("claude");
    });

    it("passes heartbeat prompt as argv without shell expansion", async () => {
        const { dir, argvFile, stdinFile } = await makeFakeCli();
        const marker = path.join(dir, "shell-expanded");
        const prompt = `Test payload $(touch ${marker})`;
        const candidate: CognitivePulseCandidate = {
            name: "fakecli",
            args: ["--message"],
            promptDelivery: "argument",
        };

        await runCognitivePulseCandidate(candidate, prompt, {
            ...process.env,
            PATH: `${dir}:${process.env.PATH || ""}`,
            MINICLAW_TEST_ARGV: argvFile,
            MINICLAW_TEST_STDIN: stdinFile,
        });

        expect(await exists(marker)).toBe(false);
        expect(await readFile(argvFile, "utf-8")).toContain(prompt);
        expect(await readFile(stdinFile, "utf-8")).toBe("");
    });

    it("passes ccr-style heartbeat prompt through stdin without shell expansion", async () => {
        const { dir, argvFile, stdinFile } = await makeFakeCli();
        const marker = path.join(dir, "stdin-shell-expanded");
        const prompt = `Inject $(touch ${marker})`;
        const candidate: CognitivePulseCandidate = {
            name: "fakecli",
            args: ["code"],
            promptDelivery: "stdin",
        };

        await runCognitivePulseCandidate(candidate, prompt, {
            ...process.env,
            PATH: `${dir}:${process.env.PATH || ""}`,
            MINICLAW_TEST_ARGV: argvFile,
            MINICLAW_TEST_STDIN: stdinFile,
        });

        expect(await exists(marker)).toBe(false);
        expect(await readFile(argvFile, "utf-8")).toBe("code\n");
        expect(await readFile(stdinFile, "utf-8")).toBe(prompt);
    });
});
