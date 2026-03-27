import { ContextKernel } from "./dist/kernel.js";
const kernel = new ContextKernel();
async function run() {
    console.log("--- Starting Methylation Verification (ESM) ---");
    for (let i = 1; i <= 6; i++) {
        console.log(`Marking habit 'Save to folder: docs' (Attempt ${i})`);
        await kernel.markHabit("Save to folder: docs", 1, 5);
    }
    console.log("--- Verification Complete ---");
}
run().catch(console.error);
