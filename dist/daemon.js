/**
 * MiniClaw Daemon: The Brainstem
 * ----------------------------
 * This is the autonomous "embryo" process that runs in the background.
 * It manages heartbeats, sensory perception, and memory metabolism
 * independently of the MCP conscious "voice".
 */
import { ContextKernel } from "./kernel.js";
async function wakeBrainstem() {
    const kernel = new ContextKernel();
    console.error("--------------------------------------------------");
    console.error("  🧬 MiniClaw Brainstem (Daemon) Waking Up...");
    console.error("--------------------------------------------------");
    // Initial heartbeat
    await kernel.heartbeat();
    // Start autonomic timers (heartbeat every 30m, sensing every 5m)
    await kernel.startAutonomic();
    console.error("[Brainstem] Autonomic systems fully active.");
    // Keep-alive: Since we only have timers, the process will stay alive.
    // We can also add process event handlers.
    process.on('SIGINT', () => {
        console.error("[Brainstem] Hibernating...");
        process.exit(0);
    });
}
wakeBrainstem().catch(err => {
    console.error(`[Brainstem Critical Failure] ${err}`);
    process.exit(1);
});
