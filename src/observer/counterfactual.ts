/**
 * Observer Protocol - Counterfactual Learning
 * 
 * Detects missed opportunities and unnecessary actions.
 * "What could I have done better?"
 */

import { InteractionHologram, HologramStore } from "./hologram.js";

export interface CounterfactualInsight {
  type: 'missed_opportunity' | 'unnecessary_action' | 'suboptimal_path' | 'premature_action';
  severity: 'low' | 'medium' | 'high';
  description: string;
  whatHappened: string;
  whatCouldHaveBeenBetter: string;
  lesson: string;
  confidence: number;
}

export class CounterfactualAnalyzer {
  constructor(private store: HologramStore) {}

  /**
   * Analyze recent interactions for counterfactual insights
   */
  async analyze(days: number = 7): Promise<CounterfactualInsight[]> {
    const holograms = await this.store.getRecentHolograms(1000);
    const insights: CounterfactualInsight[] = [];

    // Run all counterfactual analyses
    insights.push(...this.detectMissedOpportunities(holograms));
    insights.push(...this.detectUnnecessaryActions(holograms));
    insights.push(...this.detectSuboptimalPaths(holograms));
    insights.push(...this.detectPrematureActions(holograms));

    // Sort by severity and confidence
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return insights.sort((a, b) => {
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return b.confidence - a.confidence;
    });
  }

  // === Detection Methods ===

  private detectMissedOpportunities(holograms: InteractionHologram[]): CounterfactualInsight[] {
    const insights: CounterfactualInsight[] = [];

    for (const h of holograms) {
      // Pattern 1: User asked about X, I only answered, didn't offer related help
      const input = h.input.text.toLowerCase();
      
      // Git-related questions where we could have offered more
      if (input.includes('git status') && !input.includes('git log')) {
        // User asked about status, but we didn't offer to show recent commits or branch info
        if (!h.execution.tools.some(t => t.toolName.includes('git'))) {
          insights.push({
            type: 'missed_opportunity',
            severity: 'medium',
            description: 'Could have offered additional Git context',
            whatHappened: 'User asked about git status, I only provided text response',
            whatCouldHaveBeenBetter: 'Could have run git log, git branch, or offered to show diff',
            lesson: 'When user asks about Git, proactively offer related Git commands',
            confidence: 0.7,
          });
        }
      }

      // Pattern 2: User had an error, I explained but didn't offer to fix
      if ((input.includes('error') || input.includes('bug')) && h.output.response.length > 500) {
        // Long explanation but no tool usage to actually help
        if (h.execution.tools.length === 0) {
          insights.push({
            type: 'missed_opportunity',
            severity: 'high',
            description: 'Could have helped fix the error, not just explain it',
            whatHappened: 'User had an error, I provided long explanation but no actual help',
            whatCouldHaveBeenBetter: 'Could have offered to search for the error, check logs, or suggest fixes',
            lesson: 'When user has errors, prefer actionable help over explanations',
            confidence: 0.75,
          });
        }
      }

      // Pattern 3: User asked "how to do X", I explained but didn't create a reusable skill
      if (input.includes('how to') || input.includes('怎么')) {
        // Check if this is a repeated question type
        const similarQuestions = holograms.filter(prev => 
          prev.input.text.toLowerCase().includes('how to') &&
          this.similarity(prev.input.text, h.input.text) > 0.6
        );
        
        if (similarQuestions.length >= 2) {
          insights.push({
            type: 'missed_opportunity',
            severity: 'medium',
            description: 'Could have created a reusable skill for repeated how-to questions',
            whatHappened: `User asked "${h.input.text.substring(0, 50)}..." - similar to ${similarQuestions.length} previous questions`,
            whatCouldHaveBeenBetter: 'Could have created a skill to automate this workflow',
            lesson: 'When detecting repeated how-to patterns, offer to create a skill',
            confidence: 0.8,
          });
        }
      }
    }

    return insights;
  }

  private detectUnnecessaryActions(holograms: InteractionHologram[]): CounterfactualInsight[] {
    const insights: CounterfactualInsight[] = [];

    for (const h of holograms) {
      // Pattern 1: Used multiple tools when one would suffice
      if (h.execution.tools.length > 3) {
        insights.push({
          type: 'unnecessary_action',
          severity: 'low',
          description: 'Used many tools when fewer might have been better',
          whatHappened: `Used ${h.execution.tools.length} tools for: ${h.input.text.substring(0, 50)}...`,
          whatCouldHaveBeenBetter: 'Could have asked user for clarification or used a more direct approach',
          lesson: 'Prefer simplicity - fewer tool calls with clearer purpose',
          confidence: 0.6,
        });
      }

      // Pattern 2: Provided long response when user asked for something simple
      if (h.output.response.length > 1000 && h.input.text.length < 50) {
        insights.push({
          type: 'unnecessary_action',
          severity: 'medium',
          description: 'Over-explained for a simple question',
          whatHappened: `Short question: "${h.input.text}" but response was ${h.output.response.length} chars`,
          whatCouldHaveBeenBetter: 'Could have given a brief answer first, then asked if more detail needed',
          lesson: 'Match response length to question complexity',
          confidence: 0.7,
        });
      }
    }

    return insights;
  }

  private detectSuboptimalPaths(holograms: InteractionHologram[]): CounterfactualInsight[] {
    const insights: CounterfactualInsight[] = [];

    for (let i = 0; i < holograms.length - 1; i++) {
      const current = holograms[i];
      const next = holograms[i + 1];
      
      // Pattern: User had to ask a follow-up because I didn't fully answer
      const timeGap = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
      const isQuickFollowUp = timeGap < 5 * 60 * 1000; // Within 5 minutes
      
      if (isQuickFollowUp && next.input.text.toLowerCase().includes('but')) {
        insights.push({
          type: 'suboptimal_path',
          severity: 'medium',
          description: 'Incomplete answer led to follow-up question',
          whatHappened: `User asked follow-up: "${next.input.text.substring(0, 50)}..." shortly after my answer`,
          whatCouldHaveBeenBetter: 'Could have anticipated the follow-up and included it in initial response',
          lesson: 'Try to anticipate obvious follow-up questions and address them proactively',
          confidence: 0.65,
        });
      }
    }

    return insights;
  }

  private detectPrematureActions(holograms: InteractionHologram[]): CounterfactualInsight[] {
    const insights: CounterfactualInsight[] = [];

    for (const h of holograms) {
      // Pattern: Executed tool before fully understanding the problem
      if (h.execution.tools.length > 0 && h.cognition.traces.length < 2) {
        insights.push({
          type: 'premature_action',
          severity: 'medium',
          description: 'Acted too quickly without sufficient reasoning',
          whatHappened: `Executed ${h.execution.tools[0]?.toolName} with minimal reasoning steps`,
          whatCouldHaveBeenBetter: 'Could have thought through the problem more before acting',
          lesson: 'Take time to reason before executing tools',
          confidence: 0.6,
        });
      }
    }

    return insights;
  }

  // === Helpers ===

  private similarity(str1: string, str2: string): number {
    // Simple Jaccard similarity for strings
    const set1 = new Set(str1.toLowerCase().split(/\s+/));
    const set2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  // === Summary ===

  getSummary(insights: CounterfactualInsight[]): string {
    if (insights.length === 0) {
      return '';
    }

    const byType = insights.reduce((acc, i) => {
      acc[i.type] = (acc[i.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const highSeverity = insights.filter(i => i.severity === 'high').length;

    return `\n## 🪞 Counterfactual Insights (Learning from Mistakes)\n` +
      `**${insights.length} lessons** identified (${highSeverity} high priority)\n\n` +
      insights.slice(0, 3).map(i => 
        `- **${i.type.replace('_', ' ')}** (${i.severity}): ${i.lesson}`
      ).join('\n') +
      `\n`;
  }
}

// === Export ===

export function createCounterfactualAnalyzer(store: HologramStore): CounterfactualAnalyzer {
  return new CounterfactualAnalyzer(store);
}
