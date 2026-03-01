---
name: sys_observer
description: "Observe user interactions, detect patterns, and trigger DNA evolution for implicit learning."
metadata:
  exec: "node ~/.miniclaw/skills/sys_observer/run.js"
  tools:
    - name: analyze
      description: "Analyze recent interactions and detect patterns (repetition, temporal, preference, etc.)"
    - name: evolve
      description: "Trigger DNA evolution based on detected patterns to adapt to user habits"
---

# 👁️ Observer Skill (`sys_observer`)

This skill enables MiniClaw to learn implicitly from user interactions without explicit teaching. It observes patterns in the background and periodically evolves the DNA (SOUL.md, USER_MODEL.md) to become a better partner.

## What It Observes

- **Repetition Patterns**: Questions asked multiple times → suggest creating skills
- **Temporal Patterns**: Active hours, session lengths → optimize timing
- **Preference Patterns**: Response length, tool usage → adapt communication style
- **Knowledge Gaps**: Low-confidence interactions → identify learning areas
- **Workflow Patterns**: Repeated action sequences → suggest automation

## How It Works

1. **Collect**: Reads `memory/YYYY-MM-DD.md` for raw interaction data
2. **Analyze**: Detects patterns using lightweight heuristics
3. **Decide**: Determines if patterns are strong enough for evolution
4. **Evolve**: Generates proposals to update DNA files
5. **Auto-Apply**: Automatically updates SOUL.md and USER.md with detected patterns

## Execution Rules

- **Silent Mode**: Runs during idle time, no CLI output
- **Trigger**: Called by AutonomicSystem.dream() every 4+ hours of idle time
- **Auto-Evolution**: Automatically applies high-confidence changes to DNA
- **Safety**: Only appends new information, never deletes existing content
- **Cooldown**: Max 1 evolution per day to avoid over-fitting
- **Transparency**: All mutations logged to daily memory with [AUTO-EVOLVED] tag
