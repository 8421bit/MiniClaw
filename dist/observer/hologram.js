/**
 * Observer Protocol - Hologram System
 *
 * Records complete interaction traces for implicit learning.
 * Every interaction becomes a learning opportunity.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const OBSERVER_DIR = path.join(os.homedir(), ".miniclaw", "observer");
const HOLOGRAMS_DIR = path.join(OBSERVER_DIR, "holograms");
// === Hologram Store ===
export class HologramStore {
    currentSessionId;
    activeHologram = null;
    cognitionTraces = [];
    toolExecutions = [];
    constructor() {
        this.currentSessionId = this.generateSessionId();
        this.ensureDirs();
    }
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    async ensureDirs() {
        await fs.mkdir(OBSERVER_DIR, { recursive: true });
        await fs.mkdir(HOLOGRAMS_DIR, { recursive: true });
    }
    // === Recording API ===
    startInteraction(input) {
        this.activeHologram = {
            id: `holo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            sessionId: this.currentSessionId,
            timestamp: new Date().toISOString(),
            input,
            cognition: { traces: [], totalSteps: 0, finalConfidence: 0 },
            execution: { tools: [], totalDuration: 0 },
            output: { response: '', toolCalls: 0 },
            feedback: {
                implicit: {
                    followUp: false,
                    modification: false,
                    reuse: false,
                    responseTime: 0,
                    inferredSatisfaction: 0,
                }
            },
            learning: {
                patternsDetected: [],
                insights: [],
            }
        };
        this.cognitionTraces = [];
        this.toolExecutions = [];
    }
    recordCognition(trace) {
        this.cognitionTraces.push({
            ...trace,
            timestamp: new Date().toISOString(),
        });
    }
    recordToolExecution(execution) {
        this.toolExecutions.push(execution);
    }
    recordOutput(response) {
        if (this.activeHologram) {
            this.activeHologram.output = {
                response,
                toolCalls: this.toolExecutions.length,
            };
        }
    }
    recordExplicitFeedback(feedback) {
        if (this.activeHologram) {
            this.activeHologram.feedback = {
                explicit: feedback,
                implicit: this.activeHologram.feedback?.implicit || {
                    followUp: false,
                    modification: false,
                    reuse: false,
                    responseTime: 0,
                    inferredSatisfaction: 0,
                },
            };
        }
    }
    // === Finalization ===
    async finalizeInteraction(responseTime) {
        if (!this.activeHologram)
            return null;
        // Calculate implicit feedback signals
        const implicit = {
            followUp: false, // Will be updated on next interaction
            modification: false, // Will be detected by pattern analyzer
            reuse: false, // Will be detected by pattern analyzer
            responseTime,
            inferredSatisfaction: this.inferSatisfaction(responseTime),
        };
        const hologram = {
            ...this.activeHologram,
            cognition: {
                traces: this.cognitionTraces,
                totalSteps: this.cognitionTraces.length,
                finalConfidence: this.cognitionTraces[this.cognitionTraces.length - 1]?.confidence || 0.5,
            },
            execution: {
                tools: this.toolExecutions,
                totalDuration: this.toolExecutions.reduce((sum, t) => sum + t.duration, 0),
            },
            feedback: {
                ...this.activeHologram.feedback,
                implicit,
            },
        };
        // Save to disk
        await this.saveHologram(hologram);
        // Reset for next interaction
        this.activeHologram = null;
        this.cognitionTraces = [];
        this.toolExecutions = [];
        return hologram;
    }
    inferSatisfaction(responseTime) {
        // Simple heuristic: faster responses with tools = higher satisfaction
        // This will be refined by pattern analyzer over time
        if (responseTime < 1000)
            return 0.3;
        if (responseTime < 5000)
            return 0.1;
        if (responseTime < 10000)
            return 0;
        return -0.2;
    }
    async saveHologram(hologram) {
        const date = hologram.timestamp.split('T')[0];
        const filePath = path.join(HOLOGRAMS_DIR, `${date}.jsonl`);
        const line = JSON.stringify(hologram) + '\n';
        await fs.appendFile(filePath, line, 'utf-8');
    }
    // === Query API ===
    async getRecentHolograms(count = 100) {
        const files = await fs.readdir(HOLOGRAMS_DIR).catch(() => []);
        const holograms = [];
        // Sort by date descending
        const sortedFiles = files
            .filter(f => f.endsWith('.jsonl'))
            .sort()
            .reverse();
        for (const file of sortedFiles) {
            if (holograms.length >= count)
                break;
            const content = await fs.readFile(path.join(HOLOGRAMS_DIR, file), 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            for (const line of lines.reverse()) {
                if (holograms.length >= count)
                    break;
                try {
                    holograms.push(JSON.parse(line));
                }
                catch { /* skip invalid lines */ }
            }
        }
        return holograms;
    }
    async getHologramsByPattern(pattern, days = 7) {
        const all = await this.getRecentHolograms(1000);
        return all.filter(h => h.input.text.toLowerCase().includes(pattern.toLowerCase()) ||
            h.cognition.traces.some(t => t.reasoning.toLowerCase().includes(pattern.toLowerCase())));
    }
    // Update previous hologram when we detect follow-up
    async markFollowUp(previousHologramId) {
        // This is called when we detect the next interaction is related
        // Implementation would update the previous hologram's feedback.followUp
    }
}
// === Singleton Export ===
export const hologramStore = new HologramStore();
