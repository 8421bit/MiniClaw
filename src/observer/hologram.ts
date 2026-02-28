/**
 * Observer Protocol - Hologram System
 * 
 * Records complete interaction traces for implicit learning.
 * Every interaction becomes a learning opportunity.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { atomicWrite } from "../utils.js";

const OBSERVER_DIR = path.join(os.homedir(), ".miniclaw", "observer");
const HOLOGRAMS_DIR = path.join(OBSERVER_DIR, "holograms");

// === Types ===

export interface CognitionTrace {
  step: number;
  timestamp: string;
  reasoning: string;
  confidence: number;
  toolsConsidered: string[];
  toolSelected?: string;
}

export interface ToolExecution {
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  duration: number;
  timestamp: string;
}

export interface ImplicitFeedback {
  followUp: boolean;
  modification: boolean;
  reuse: boolean;
  responseTime: number;
  inferredSatisfaction: number; // -1 to 1
}

export interface InteractionHologram {
  id: string;
  sessionId: string;
  timestamp: string;
  
  input: {
    text: string;
    contextFiles: string[];
    workspaceInfo?: {
      name: string;
      gitBranch?: string;
      techStack: string[];
    };
  };
  
  cognition: {
    traces: CognitionTrace[];
    totalSteps: number;
    finalConfidence: number;
  };
  
  execution: {
    tools: ToolExecution[];
    totalDuration: number;
  };
  
  output: {
    response: string;
    toolCalls: number;
  };
  
  feedback: {
    explicit?: string;
    implicit: ImplicitFeedback;
  };
  
  // Learning metadata
  learning: {
    patternsDetected: string[];
    insights: string[];
    appliedInSession?: string;
  };
}

// === Hologram Store ===

export class HologramStore {
  private currentSessionId: string;
  private activeHologram: Partial<InteractionHologram> | null = null;
  private cognitionTraces: CognitionTrace[] = [];
  private toolExecutions: ToolExecution[] = [];
  
  constructor() {
    this.currentSessionId = this.generateSessionId();
    this.ensureDirs();
  }
  
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  private async ensureDirs(): Promise<void> {
    await fs.mkdir(OBSERVER_DIR, { recursive: true });
    await fs.mkdir(HOLOGRAMS_DIR, { recursive: true });
  }
  
  // === Recording API ===
  
  startInteraction(input: {
    text: string;
    contextFiles: string[];
    workspaceInfo?: InteractionHologram['input']['workspaceInfo'];
  }): void {
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
  
  recordCognition(trace: Omit<CognitionTrace, 'timestamp'>): void {
    this.cognitionTraces.push({
      ...trace,
      timestamp: new Date().toISOString(),
    });
  }
  
  recordToolExecution(execution: ToolExecution): void {
    this.toolExecutions.push(execution);
  }
  
  recordOutput(response: string): void {
    if (this.activeHologram) {
      this.activeHologram.output = {
        response,
        toolCalls: this.toolExecutions.length,
      };
    }
  }
  
  recordExplicitFeedback(feedback: string): void {
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
  
  async finalizeInteraction(responseTime: number): Promise<InteractionHologram | null> {
    if (!this.activeHologram) return null;
    
    // Calculate implicit feedback signals
    const implicit: ImplicitFeedback = {
      followUp: false, // Will be updated on next interaction
      modification: false, // Will be detected by pattern analyzer
      reuse: false, // Will be detected by pattern analyzer
      responseTime,
      inferredSatisfaction: this.inferSatisfaction(responseTime),
    };
    
    const hologram: InteractionHologram = {
      ...this.activeHologram as InteractionHologram,
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
  
  private inferSatisfaction(responseTime: number): number {
    // Simple heuristic: faster responses with tools = higher satisfaction
    // This will be refined by pattern analyzer over time
    if (responseTime < 1000) return 0.3;
    if (responseTime < 5000) return 0.1;
    if (responseTime < 10000) return 0;
    return -0.2;
  }
  
  private async saveHologram(hologram: InteractionHologram): Promise<void> {
    const date = hologram.timestamp.split('T')[0];
    const filePath = path.join(HOLOGRAMS_DIR, `${date}.jsonl`);
    
    const line = JSON.stringify(hologram) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  }
  
  // === Query API ===
  
  async getRecentHolograms(count: number = 100): Promise<InteractionHologram[]> {
    const files = await fs.readdir(HOLOGRAMS_DIR).catch(() => [] as string[]);
    const holograms: InteractionHologram[] = [];
    
    // Sort by date descending
    const sortedFiles = files
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();
    
    for (const file of sortedFiles) {
      if (holograms.length >= count) break;
      
      const content = await fs.readFile(path.join(HOLOGRAMS_DIR, file), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      for (const line of lines.reverse()) {
        if (holograms.length >= count) break;
        try {
          holograms.push(JSON.parse(line));
        } catch { /* skip invalid lines */ }
      }
    }
    
    return holograms;
  }
  
  async getHologramsByPattern(pattern: string, days: number = 7): Promise<InteractionHologram[]> {
    const all = await this.getRecentHolograms(1000);
    return all.filter(h => 
      h.input.text.toLowerCase().includes(pattern.toLowerCase()) ||
      h.cognition.traces.some(t => t.reasoning.toLowerCase().includes(pattern.toLowerCase()))
    );
  }
  
  // Update previous hologram when we detect follow-up
  async markFollowUp(previousHologramId: string): Promise<void> {
    // This is called when we detect the next interaction is related
    // Implementation would update the previous hologram's feedback.followUp
  }
}

// === Singleton Export ===

export const hologramStore = new HologramStore();
