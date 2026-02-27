/**
 * sys_perceiver: Visual Perception Logic
 * Handles payloads containing screenshot paths or base64 data.
 */

const fs = require('fs');
const path = require('path');

async function run() {
    const argsStr = process.argv[2];
    if (!argsStr) return;

    try {
        const args = JSON.parse(argsStr);
        const { event, screenshot, base64 } = args;

        console.log(`👁️ Perceiver active for event: ${event}`);

        if (screenshot || base64) {
            console.log("\n[VISION_SIGNAL: Detected]");
            console.log(`- Source: ${screenshot ? 'File path' : 'Base64 Stream'}`);
            
            // Instruction to the LLM Host
            console.log(`
INSTRUCTION:
The kernel has provided a visual signal. 
1. If 'screenshot' is a path, read the file and use its image content.
2. If 'base64' is provided, decode and use the image content.
3. Compare this visual state with the code changes in ${args.filename || 'unknown file'}.
4. Does the UI look broken? If yes, provide a fix in your next response.
`);
        } else if (event === "onFileChanged") {
            console.log("No vision signal in file change, but Perceiver is watching for regressions.");
        }

    } catch (e) {
        console.error("Perceiver parsing failed:", e);
    }
}

run().catch(err => {
    console.error("Perceiver failed:", err);
    process.exit(1);
});
