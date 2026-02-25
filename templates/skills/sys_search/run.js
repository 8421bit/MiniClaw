const fs = require('fs/promises');
const path = require('path');

const HOME_DIR = process.env.HOME || process.cwd();
const MINICLAW_DIR = path.join(HOME_DIR, ".miniclaw");

function fuzzyScore(str, query) {
    let score = 0;
    const s = str.toLowerCase();
    const q = query.toLowerCase();

    // Direct inclusion gets high score
    if (s.includes(q)) return 100;

    // Split by spaces to find keywords
    const keywords = q.split(' ').filter(k => k.length > 0);
    if (keywords.length === 0) return 0;

    let matchCount = 0;
    for (const kw of keywords) {
        if (s.includes(kw)) {
            matchCount++;
            score += 10;
        }
    }

    // All keywords match means good score
    if (matchCount === keywords.length && keywords.length > 1) {
        score += 50;
    }

    return score;
}

async function searchFiles(dir, query) {
    const results = [];
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return results; }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        if (entry.isDirectory()) {
            const sub = await searchFiles(fullPath, query);
            results.push(...sub);
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
            try {
                const content = await fs.readFile(fullPath, 'utf-8');
                const relPath = path.relative(MINICLAW_DIR, fullPath);

                content.split('\\n').forEach((line, i) => {
                    const score = fuzzyScore(line, query);
                    if (score > 0) {
                        results.push({ file: relPath, line: i + 1, content: line.trim(), score });
                    }
                });
            } catch { } // Skip unreadable
        }
    }
    return results;
}

async function main() {
    const query = process.env.INPUT_QUERY;
    const bucket = process.env.INPUT_BUCKET || "all";

    if (!query) {
        console.error("Query is required.");
        process.exit(1);
    }

    let searchDir = MINICLAW_DIR;
    if (bucket === "memory") searchDir = path.join(MINICLAW_DIR, "memory");
    if (bucket === "skills") searchDir = path.join(MINICLAW_DIR, "skills");

    const allMatches = await searchFiles(searchDir, query);

    // Sort by descending score
    allMatches.sort((a, b) => b.score - a.score);

    const formatted = allMatches.slice(0, 50).map(m => `[${m.score}] ${m.file}:${m.line}: ${m.content}`);

    console.log(formatted.join('\\n') || "No matches found.");
}

main().catch(e => {
    console.error(e.message);
    process.exit(1);
});
