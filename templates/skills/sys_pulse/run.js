/**
 * sys_pulse: Discovery and Handshake Logic
 * Scans the shared pulse directory for active MiniClaw heartbeats.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PULSE_DIR = path.join(os.homedir(), '.miniclaw', 'pulse');

async function run() {
    console.log("📡 Pulsing for other Embryos...");

    if (!fs.existsSync(PULSE_DIR)) {
        try {
            fs.mkdirSync(PULSE_DIR, { recursive: true });
        } catch (e) {
            console.error("Failed to create pulse directory:", e);
            return;
        }
    }

    // 1. Write our own heartbeat pulse
    const myId = process.env.MINICLAW_ID || 'sovereign-alpha';
    const myPulse = path.join(PULSE_DIR, `${myId}.json`);
    const pulseData = {
        id: myId,
        timestamp: new Date().toISOString(),
        vitals_hint: "active",
        public_key_hint: "mcp-local"
    };
    fs.writeFileSync(myPulse, JSON.stringify(pulseData, null, 2));

    // 2. Scan for others
    const files = fs.readdirSync(PULSE_DIR);
    const others = files.filter(f => f.endsWith('.json') && f !== `${myId}.json`);

    if (others.length === 0) {
        console.log("No other pulses detected. You are singular.");
        return;
    }

    console.log(`\n[PULSE_DETECTED: ${others.length} agents found]`);
    others.forEach(f => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(PULSE_DIR, f), 'utf-8'));
            console.log(`- Agent: ${data.id} (Last seen: ${data.timestamp})`);
        } catch (e) {
            console.error(`Malformed pulse in ${f}`);
        }
    });

    // 3. Propose Syncing
    console.log("\n[SEMANTIC_SYNC: Proposal]");
    console.log("Rule: Syncing only non-private concepts (scope: public).");
    console.log("If you find a concept you lack, use `miniclaw_update` to adopt it.");
    
    // Example logic: Scan target agent's CONCEPTS.md if accessible
    others.forEach(f => {
        const targetId = f.replace('.json', '');
        const targetConcepts = path.join(os.homedir(), '.miniclaw', 'pulse', `${targetId}_CONCEPTS.md`);
        if (fs.existsSync(targetConcepts)) {
            console.log(`- Detected shareable concepts from ${targetId}. Proposing merge...`);
        }
    });

    console.log("\nProposing Handshake: Please use `miniclaw_introspect` on target pulse to view public metadata.");
}

run().catch(err => {
    console.error("Pulse failed:", err);
    process.exit(1);
});
