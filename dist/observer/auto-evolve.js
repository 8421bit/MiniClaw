/**
 * Observer Protocol - Auto-Evolution Trigger
 *
 * Automatically triggers DNA evolution when strong patterns are detected.
 * This is the key to true implicit learning - evolution without user intervention.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createPatternDetector } from "./patterns.js";
import { dnaEvolver } from "./evolver.js";
const MINICLAW_DIR = path.join(os.homedir(), ".miniclaw");
const EVOLUTION_STATE_FILE = path.join(MINICLAW_DIR, "observer", "evolution-state.json");
const DEFAULT_THRESHOLDS = {
    minConfidence: 0.75, // 75% confidence required
    minPatterns: 2, // At least 2 patterns
    cooldownHours: 24, // Max once per day
    maxProposalsPerEvolution: 3, // Don't overwhelm with too many changes
};
const DEFAULT_STATE = {
    lastAutoEvolution: null,
    totalAutoEvolutions: 0,
    appliedProposals: [],
    rejectedProposals: [],
};
// === Auto-Evolution Engine ===
export class AutoEvolutionEngine {
    thresholds;
    state = DEFAULT_STATE;
    store;
    detector;
    constructor(store, thresholds = {}) {
        this.store = store;
        this.detector = createPatternDetector(store);
        this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
        this.loadState();
    }
    async loadState() {
        try {
            const raw = await fs.readFile(EVOLUTION_STATE_FILE, "utf-8");
            this.state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
        }
        catch {
            // First run, use defaults
            this.state = { ...DEFAULT_STATE };
        }
    }
    async saveState() {
        await fs.mkdir(path.dirname(EVOLUTION_STATE_FILE), { recursive: true });
        await fs.writeFile(EVOLUTION_STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
    }
    // === Main Check ===
    /**
     * Check if auto-evolution should trigger
     * Call this periodically (e.g., during heartbeat)
     */
    async checkAndEvolve() {
        // Check cooldown
        if (this.isInCooldown()) {
            return {
                evolved: false,
                message: `⏳ Auto-evolution in cooldown. Last evolution: ${this.state.lastAutoEvolution}`,
            };
        }
        // Detect patterns
        const patterns = await this.detector.analyzeRecent(7);
        // Filter high-confidence patterns
        const strongPatterns = patterns.filter(p => p.confidence >= this.thresholds.minConfidence);
        if (strongPatterns.length < this.thresholds.minPatterns) {
            return {
                evolved: false,
                message: `📊 Insufficient strong patterns (${strongPatterns.length}/${this.thresholds.minPatterns})`,
            };
        }
        // Generate proposals
        const allProposals = await dnaEvolver.generateProposals(strongPatterns);
        // Filter to top proposals
        const proposals = allProposals
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, this.thresholds.maxProposalsPerEvolution);
        if (proposals.length === 0) {
            return {
                evolved: false,
                message: "🧬 Patterns detected, but no actionable proposals",
            };
        }
        // Apply evolution
        const result = await dnaEvolver.applyProposals(proposals);
        if (result.applied) {
            // Update state
            this.state.lastAutoEvolution = new Date().toISOString();
            this.state.totalAutoEvolutions++;
            for (const p of proposals) {
                this.state.appliedProposals.push({
                    timestamp: new Date().toISOString(),
                    targetFile: p.targetFile,
                    section: p.section,
                    confidence: p.confidence,
                });
            }
            await this.saveState();
            return {
                evolved: true,
                message: `🧬 Auto-evolution complete! Applied ${proposals.length} proposals.`,
                proposals,
            };
        }
        else {
            this.state.rejectedProposals.push({
                timestamp: new Date().toISOString(),
                reason: result.message,
                proposals,
            });
            await this.saveState();
            return {
                evolved: false,
                message: `❌ Auto-evolution failed: ${result.message}`,
                proposals,
            };
        }
    }
    isInCooldown() {
        if (!this.state.lastAutoEvolution)
            return false;
        const last = new Date(this.state.lastAutoEvolution);
        const now = new Date();
        const hoursSince = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
        return hoursSince < this.thresholds.cooldownHours;
    }
    // === Status ===
    async getStatus() {
        const patterns = await this.detector.analyzeRecent(7);
        const strongPatterns = patterns.filter(p => p.confidence >= this.thresholds.minConfidence);
        let cooldownRemaining = 0;
        if (this.state.lastAutoEvolution) {
            const last = new Date(this.state.lastAutoEvolution);
            const now = new Date();
            const hoursSince = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
            cooldownRemaining = Math.max(0, this.thresholds.cooldownHours - hoursSince);
        }
        return {
            canEvolve: !this.isInCooldown() && strongPatterns.length >= this.thresholds.minPatterns,
            cooldownRemaining,
            totalEvolutions: this.state.totalAutoEvolutions,
            recentProposals: strongPatterns.length,
        };
    }
    // === Configuration ===
    async updateThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        // Save to config file
        const configPath = path.join(MINICLAW_DIR, "observer", "thresholds.json");
        await fs.writeFile(configPath, JSON.stringify(this.thresholds, null, 2), "utf-8");
    }
    getThresholds() {
        return { ...this.thresholds };
    }
}
// === Export ===
export function createAutoEvolutionEngine(store) {
    return new AutoEvolutionEngine(store);
}
