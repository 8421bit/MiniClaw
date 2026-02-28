/**
 * Observer Protocol - DNA Evolution Engine
 *
 * Transforms detected patterns into DNA (SOUL.md, USER_MODEL.md) updates.
 * This is the core of implicit learning - turning observations into self-evolution.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { atomicWrite } from "../utils.js";
const MINICLAW_DIR = path.join(os.homedir(), ".miniclaw");
// === DNA Evolver ===
export class DNAEvolver {
    proposals = [];
    /**
     * Generate evolution proposals from detected patterns
     */
    async generateProposals(patterns) {
        this.proposals = [];
        for (const pattern of patterns) {
            if (pattern.confidence < 0.6)
                continue; // Only high-confidence patterns
            switch (pattern.type) {
                case 'preference':
                    await this.handlePreferencePattern(pattern);
                    break;
                case 'repetition':
                    await this.handleRepetitionPattern(pattern);
                    break;
                case 'temporal':
                    await this.handleTemporalPattern(pattern);
                    break;
                case 'knowledge_gap':
                    await this.handleKnowledgeGapPattern(pattern);
                    break;
                case 'workflow':
                    await this.handleWorkflowPattern(pattern);
                    break;
            }
        }
        return this.proposals;
    }
    // === Pattern Handlers ===
    async handlePreferencePattern(pattern) {
        // User prefers concise responses
        if (pattern.description.includes('concise') || pattern.description.includes('简洁')) {
            this.proposals.push({
                targetFile: 'SOUL.md',
                section: 'Communication Style',
                currentContent: '',
                proposedContent: `\n## Communication Style (Auto-Evolved)\n\n**Brevity Preference:** User prefers concise, direct responses.\n- Avoid lengthy explanations unless explicitly requested\n- Lead with the answer, provide details only if needed\n- Use bullet points over paragraphs when possible\n\n*Evolved from pattern: ${pattern.description}*`,
                reasoning: 'Detected user preference for concise responses through satisfaction analysis',
                confidence: pattern.confidence,
                patternEvidence: pattern.evidence,
            });
        }
        // User prefers tool usage
        if (pattern.description.includes('tool')) {
            this.proposals.push({
                targetFile: 'SOUL.md',
                section: 'Action Orientation',
                currentContent: '',
                proposedContent: `\n## Action Orientation (Auto-Evolved)\n\n**Proactive Tool Usage:** User values actions over words.\n- Prefer using tools to demonstrate rather than just explaining\n- When in doubt, execute and show results\n- User satisfaction correlates with tool usage\n\n*Evolved from pattern: ${pattern.description}*`,
                reasoning: 'User shows higher satisfaction when tools are used vs just conversation',
                confidence: pattern.confidence,
                patternEvidence: pattern.evidence,
            });
        }
    }
    async handleRepetitionPattern(pattern) {
        // Extract topic from description
        const topicMatch = pattern.description.match(/about "([^"]+)"/);
        const topic = topicMatch ? topicMatch[1] : 'frequent topics';
        this.proposals.push({
            targetFile: 'USER_MODEL.md',
            section: 'Knowledge Gaps & Interests',
            currentContent: '',
            proposedContent: `\n## Knowledge Gaps & Interests (Auto-Evolved)\n\n**Frequent Interest:** ${topic.toUpperCase()}\n- User has asked about this ${pattern.evidence.length}+ times\n- May indicate: learning phase, complex topic, or preferred domain\n- Approach: Provide comprehensive answers, anticipate follow-ups\n\n*Detected: ${new Date().toISOString().split('T')[0]}*`,
            reasoning: `User repeatedly asks about "${topic}" - indicating strong interest or ongoing learning`,
            confidence: pattern.confidence,
            patternEvidence: pattern.evidence,
        });
        // Also suggest creating a skill
        this.proposals.push({
            targetFile: 'TOOLS.md',
            section: 'Suggested Skills',
            currentContent: '',
            proposedContent: `\n## Suggested Skills (Auto-Evolved)\n\n**${topic} Assistant:** Consider creating a specialized skill for ${topic} support\n- Reason: User asks about this frequently\n- Would save time and provide consistent help\n- Priority: Medium\n\n*Suggested by: Observer pattern detection*`,
            reasoning: 'Repetitive questions suggest value in automation',
            confidence: pattern.confidence * 0.8, // Slightly lower confidence for skill creation
            patternEvidence: pattern.evidence,
        });
    }
    async handleTemporalPattern(pattern) {
        const hoursMatch = pattern.description.match(/at: ([\d:, ]+)/);
        const hours = hoursMatch ? hoursMatch[1] : 'specific times';
        this.proposals.push({
            targetFile: 'USER_MODEL.md',
            section: 'Temporal Patterns',
            currentContent: '',
            proposedContent: `\n## Temporal Patterns (Auto-Evolved)\n\n**Active Hours:** ${hours}\n- User is most engaged during these hours\n- Ideal time for proactive check-ins\n- Avoid scheduling heavy tasks outside these windows\n\n*Pattern confidence: ${(pattern.confidence * 100).toFixed(0)}%*`,
            reasoning: 'Detected consistent activity patterns',
            confidence: pattern.confidence,
            patternEvidence: pattern.evidence,
        });
    }
    async handleKnowledgeGapPattern(pattern) {
        this.proposals.push({
            targetFile: 'SOUL.md',
            section: 'Growth Areas',
            currentContent: '',
            proposedContent: `\n## Growth Areas (Auto-Evolved)\n\n**Learning Focus:** Areas where I need to improve\n- Topics: ${pattern.description.replace('I struggle with: ', '')}\n- Action: Study these topics or ask user for guidance\n- Goal: Reduce low-confidence responses in these areas\n\n*Self-identified: ${new Date().toISOString().split('T')[0]}*`,
            reasoning: 'Self-identified knowledge gaps through low-confidence interactions',
            confidence: pattern.confidence,
            patternEvidence: pattern.evidence,
        });
    }
    async handleWorkflowPattern(pattern) {
        this.proposals.push({
            targetFile: 'TOOLS.md',
            section: 'Workflow Automation Opportunities',
            currentContent: '',
            proposedContent: `\n## Workflow Automation (Auto-Evolved)\n\n**Detected Pattern:** ${pattern.description}\n- User repeats this sequence regularly\n- Opportunity: Create a skill to automate this workflow\n- Benefit: Save time, reduce errors\n\n*Next step: Ask user if they want this automated*`,
            reasoning: 'Repetitive workflow detected - automation candidate',
            confidence: pattern.confidence,
            patternEvidence: pattern.evidence,
        });
    }
    // === Application ===
    /**
     * Apply evolution proposals to DNA files
     */
    async applyProposals(proposals) {
        const applied = [];
        const messages = [];
        for (const proposal of proposals) {
            try {
                const filePath = path.join(MINICLAW_DIR, proposal.targetFile);
                // Read current content
                let currentContent = '';
                try {
                    currentContent = await fs.readFile(filePath, 'utf-8');
                }
                catch {
                    // File doesn't exist, will create
                    currentContent = `---\nboot-priority: 50\n---\n\n# ${proposal.targetFile.replace('.md', '')}\n\n`;
                }
                // Check if this section already exists
                if (currentContent.includes(proposal.section)) {
                    // Update existing section (simple append for now)
                    // In production, would need more sophisticated merging
                    messages.push(`⚠️ Section "${proposal.section}" already exists in ${proposal.targetFile}, skipping`);
                    continue;
                }
                // Append new section
                const newContent = currentContent + proposal.proposedContent;
                await atomicWrite(filePath, newContent);
                applied.push(proposal);
                messages.push(`✅ Evolved ${proposal.targetFile}: Added "${proposal.section}"`);
            }
            catch (error) {
                messages.push(`❌ Failed to evolve ${proposal.targetFile}: ${error}`);
            }
        }
        return {
            applied: applied.length > 0,
            proposals: applied,
            message: messages.join('\n'),
        };
    }
    /**
     * Get evolution summary for display
     */
    getEvolutionSummary(proposals) {
        if (proposals.length === 0)
            return '';
        const byFile = proposals.reduce((acc, p) => {
            acc[p.targetFile] = (acc[p.targetFile] || 0) + 1;
            return acc;
        }, {});
        return `\n## 🧬 DNA Evolution Proposals\n` +
            proposals.map(p => `- **${p.targetFile}** → ${p.section} (confidence: ${(p.confidence * 100).toFixed(0)}%)`).join('\n') +
            `\n\n*Run \`miniclaw_evolve\` to apply these changes*\n`;
    }
}
// === Export ===
export const dnaEvolver = new DNAEvolver();
