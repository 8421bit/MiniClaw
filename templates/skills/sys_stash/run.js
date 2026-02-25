const fs = require('fs/promises');
const path = require('path');

const HOME_DIR = process.env.HOME || process.cwd();
const MINICLAW_DIR = path.join(HOME_DIR, ".miniclaw");
const STASH_FILE = path.join(MINICLAW_DIR, "STASH.json");

async function main() {
    const action = process.env.INPUT_ACTION || 'list';
    const key = process.env.INPUT_KEY;
    const valueStr = process.env.INPUT_VALUE;

    await fs.mkdir(MINICLAW_DIR, { recursive: true }).catch(() => { });

    let stashData = {};
    try {
        const content = await fs.readFile(STASH_FILE, 'utf-8');
        stashData = JSON.parse(content);
    } catch { }

    if (action === "clear") {
        try { await fs.unlink(STASH_FILE); } catch { }
        console.log("Stash cleared.");
        return;
    }

    if (action === "list") {
        const keys = Object.keys(stashData);
        if (keys.length === 0) { console.log("Stash is empty."); return; }
        console.log(`Current Stash:\\n\`\`\`json\\n${JSON.stringify(stashData, null, 2)}\\n\`\`\``);
        return;
    }

    if (action === "load") {
        if (!key) throw new Error("Key is required for load action.");
        if (!(key in stashData)) { console.log(`Key '${key}' not found in stash.`); return; }
        console.log(JSON.stringify(stashData[key], null, 2));
        return;
    }

    if (action === "save") {
        if (!key) throw new Error("Key is required for save action.");
        if (!valueStr) throw new Error("Value is required for save action.");

        let val = valueStr;
        try { val = JSON.parse(valueStr); } catch { } // If it's valid JSON, store as JSON

        stashData[key] = val;
        await fs.writeFile(STASH_FILE, JSON.stringify(stashData, null, 2), 'utf-8');
        console.log(`Saved to stash under key: ${key}`);
        return;
    }

    console.error("Unknown action.");
}

main().catch(e => {
    console.error(e.message);
    process.exit(1);
});
