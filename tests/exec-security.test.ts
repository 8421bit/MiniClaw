import { describe, expect, it } from "vitest";
import { ContextKernel } from "../src/kernel.js";

describe("miniclaw_exec security", () => {
    it("rejects shell metacharacters before execution", async () => {
        const kernel = new ContextKernel();

        await expect(kernel.execCommand("git status; touch /tmp/miniclaw-owned"))
            .rejects.toThrow("Security violation");
    });

    it("blocks inline interpreter execution", async () => {
        const kernel = new ContextKernel();

        await expect(kernel.execCommand("node -e \"console.log(1)\""))
            .rejects.toThrow("Security violation");
        await expect(kernel.execCommand("python -c \"print(1)\""))
            .rejects.toThrow("Security violation");
    });

    it("blocks sensitive local paths even for otherwise allowed commands", async () => {
        const kernel = new ContextKernel();

        await expect(kernel.execCommand("cat ~/.ssh/id_rsa"))
            .rejects.toThrow("Security violation");
        await expect(kernel.execCommand("cat .env"))
            .rejects.toThrow("Security violation");
    });
});
