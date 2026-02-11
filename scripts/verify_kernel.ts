
import { ContextKernel } from "../src/kernel.js";

async function main() {
    const kernel = new ContextKernel();

    console.log("🔍 Verifying MiniClaw Kernel...\n");

    console.log("--- 🟢 BOOT: FULL MODE ---");
    const fullContext = await kernel.boot({ type: "full" });
    console.log(fullContext);
    console.log(`\n[Stats] Full Context Length: ${fullContext.length} chars`);

    console.log("\n--- 🟡 BOOT: MINIMAL MODE ---");
    const minimalContext = await kernel.boot({ type: "minimal" });
    console.log(minimalContext);
    console.log(`\n[Stats] Minimal Context Length: ${minimalContext.length} chars`);

    // Check critical segments
    const checks = [
        { name: "Runtime Info", passed: fullContext.includes("Runtime: agent=main") },
        { name: "Identity Injection", passed: fullContext.includes("You are a personal assistant running inside MiniClaw 0.5") },
        { name: "Subagent Mode", passed: minimalContext.includes("You are a subagent") },
        { name: "Subagent No-Soul", passed: !minimalContext.includes("If SOUL.md is present") },
        // Phase 20 Checks
        { name: "Workspace Awareness", passed: fullContext.includes("Workspace Awareness") },
        { name: "Project Path Check", passed: fullContext.includes("miniclaw") }
    ];

    console.log("\n--- 🧪 NERVOUS SYSTEM CHECKS ---");
    try {
        const execRes = await kernel.execCommand("echo 'Hands Working'");
        console.log(`[Exec Test] Output: ${execRes.output.trim()} (Code: ${execRes.exitCode})`);
        checks.push({ name: "Exec Capability", passed: execRes.output.includes("Hands Working") && execRes.exitCode === 0 });
    } catch (e) {
        console.error(`[Exec Test] Failed: ${e}`);
        checks.push({ name: "Exec Capability", passed: false });
    }

    console.log("\n--- ✅ VERIFICATION REPORT ---");
    checks.forEach(c => console.log(`${c.passed ? "PASSED" : "FAILED"} - ${c.name}`));
}

main().catch(console.error);
