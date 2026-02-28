/**
 * Observer Protocol - Pattern Detection Engine
 *
 * Detects patterns from holograms for implicit learning.
 */
export class PatternDetector {
    store;
    constructor(store) {
        this.store = store;
    }
    async analyzeRecent(days = 7) {
        const holograms = await this.store.getRecentHolograms(1000);
        const patterns = [];
        // Run all detection algorithms
        patterns.push(...this.detectRepetitions(holograms));
        patterns.push(...this.detectTemporalPatterns(holograms));
        patterns.push(...this.detectPreferences(holograms));
        patterns.push(...this.detectKnowledgeGaps(holograms));
        patterns.push(...this.detectWorkflows(holograms));
        // Sort by confidence
        return patterns.sort((a, b) => b.confidence - a.confidence);
    }
    // === Detection Algorithms ===
    detectRepetitions(holograms) {
        const patterns = [];
        const questionTypes = new Map();
        // Group similar questions
        for (const h of holograms) {
            const text = h.input.text.toLowerCase();
            // Extract question type
            let type = null;
            if (text.includes('git'))
                type = 'git';
            else if (text.includes('error') || text.includes('bug'))
                type = 'debugging';
            else if (text.includes('how to') || text.includes('怎么'))
                type = 'howto';
            else if (text.includes('what is') || text.includes('什么是'))
                type = 'concept';
            if (type) {
                questionTypes.set(type, (questionTypes.get(type) || 0) + 1);
            }
        }
        // Report high-frequency patterns
        for (const [type, count] of questionTypes) {
            if (count >= 3) {
                patterns.push({
                    type: 'repetition',
                    confidence: Math.min(count / 10, 0.95),
                    description: `User frequently asks about "${type}" (${count} times)`,
                    evidence: holograms
                        .filter(h => h.input.text.toLowerCase().includes(type))
                        .slice(0, 3)
                        .map(h => h.input.text.substring(0, 100)),
                    suggestedAction: `Consider creating a specialized skill for "${type}" assistance`,
                });
            }
        }
        return patterns;
    }
    detectTemporalPatterns(holograms) {
        const patterns = [];
        const hourCounts = new Array(24).fill(0);
        for (const h of holograms) {
            const hour = new Date(h.timestamp).getHours();
            hourCounts[hour]++;
        }
        // Find peak hours
        const maxCount = Math.max(...hourCounts);
        const peakHours = hourCounts
            .map((count, hour) => ({ hour, count }))
            .filter(h => h.count > maxCount * 0.5 && h.count >= 3)
            .sort((a, b) => b.count - a.count);
        if (peakHours.length > 0) {
            const hourStr = peakHours.map(h => `${h.hour}:00`).join(', ');
            patterns.push({
                type: 'temporal',
                confidence: 0.7,
                description: `User is most active at: ${hourStr}`,
                evidence: peakHours.map(h => `${h.hour}:00 (${h.count} interactions)`),
                suggestedAction: 'Schedule proactive check-ins during these hours',
            });
        }
        return patterns;
    }
    detectPreferences(holograms) {
        const patterns = [];
        // Analyze response satisfaction correlation
        const shortResponses = holograms.filter(h => h.output.response.length < 200);
        const longResponses = holograms.filter(h => h.output.response.length >= 200);
        const shortSatisfaction = this.avgSatisfaction(shortResponses);
        const longSatisfaction = this.avgSatisfaction(longResponses);
        if (shortSatisfaction > longSatisfaction + 0.2) {
            patterns.push({
                type: 'preference',
                confidence: 0.75,
                description: 'User prefers concise responses over detailed explanations',
                evidence: [
                    `Short responses avg satisfaction: ${shortSatisfaction.toFixed(2)}`,
                    `Long responses avg satisfaction: ${longSatisfaction.toFixed(2)}`,
                ],
                suggestedAction: 'Update SOUL.md to prefer brevity',
            });
        }
        // Analyze tool usage preference
        const withTools = holograms.filter(h => h.execution.tools.length > 0);
        const withoutTools = holograms.filter(h => h.execution.tools.length === 0);
        const withToolsSat = this.avgSatisfaction(withTools);
        const withoutToolsSat = this.avgSatisfaction(withoutTools);
        if (withToolsSat > withoutToolsSat + 0.15) {
            patterns.push({
                type: 'preference',
                confidence: 0.7,
                description: 'User prefers when I use tools to help (vs just talking)',
                evidence: [
                    `With tools avg satisfaction: ${withToolsSat.toFixed(2)}`,
                    `Without tools avg satisfaction: ${withoutToolsSat.toFixed(2)}`,
                ],
                suggestedAction: 'Be more proactive in using tools',
            });
        }
        return patterns;
    }
    detectKnowledgeGaps(holograms) {
        const patterns = [];
        // Find low-confidence interactions
        const lowConfidence = holograms.filter(h => h.cognition.finalConfidence < 0.5 &&
            h.feedback.implicit.inferredSatisfaction < 0);
        if (lowConfidence.length >= 3) {
            const topics = lowConfidence.map(h => {
                const text = h.input.text;
                // Extract key terms (simple approach)
                return text.split(' ').slice(0, 5).join(' ');
            });
            patterns.push({
                type: 'knowledge_gap',
                confidence: 0.6,
                description: `I struggle with: ${topics.slice(0, 3).join('; ')}`,
                evidence: lowConfidence.slice(0, 3).map(h => h.input.text.substring(0, 100)),
                suggestedAction: 'Study these topics or ask user for guidance',
            });
        }
        return patterns;
    }
    detectWorkflows(holograms) {
        const patterns = [];
        // Look for sequences of interactions
        const sequences = [];
        let currentSeq = [];
        for (let i = 0; i < holograms.length; i++) {
            const h = holograms[i];
            const type = this.classifyInteraction(h);
            if (currentSeq.length === 0 || this.isRelated(currentSeq[currentSeq.length - 1], type)) {
                currentSeq.push(type);
            }
            else {
                if (currentSeq.length >= 3) {
                    sequences.push([...currentSeq]);
                }
                currentSeq = [type];
            }
        }
        // Find common sequences
        const seqCounts = new Map();
        for (const seq of sequences) {
            const key = seq.join(' -> ');
            seqCounts.set(key, (seqCounts.get(key) || 0) + 1);
        }
        for (const [seq, count] of seqCounts) {
            if (count >= 2) {
                patterns.push({
                    type: 'workflow',
                    confidence: 0.65,
                    description: `Detected workflow pattern: ${seq}`,
                    evidence: [`Repeated ${count} times`],
                    suggestedAction: 'Offer to automate this workflow as a skill',
                });
            }
        }
        return patterns;
    }
    // === Helpers ===
    avgSatisfaction(holograms) {
        if (holograms.length === 0)
            return 0;
        const sum = holograms.reduce((acc, h) => acc + h.feedback.implicit.inferredSatisfaction, 0);
        return sum / holograms.length;
    }
    classifyInteraction(h) {
        const text = h.input.text.toLowerCase();
        if (text.includes('git'))
            return 'git';
        if (text.includes('file') || text.includes('read'))
            return 'file';
        if (text.includes('write') || text.includes('edit'))
            return 'edit';
        if (text.includes('run') || text.includes('execute'))
            return 'execute';
        return 'general';
    }
    isRelated(prev, curr) {
        // Simple heuristic: same type or common workflow pairs
        if (prev === curr)
            return true;
        const pairs = {
            'git': ['file', 'edit'],
            'file': ['edit', 'git'],
            'edit': ['run', 'execute'],
        };
        return pairs[prev]?.includes(curr) || false;
    }
}
// === Export ===
export const createPatternDetector = (store) => new PatternDetector(store);
