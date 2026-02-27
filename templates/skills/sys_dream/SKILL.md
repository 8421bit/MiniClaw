---
name: sys_dream
description: "Trigger the subconscious dream state to process today's memory and unearth entities."
metadata:
  version: "0.7.0"
  exec: "node ./run.js"
  tools:
    - name: run
      description: "Trigger the subconscious dream state to process today's memory and unearth entities. Used internally by the heartbeat crawler."
---

# 🌌 Subconscious Dreaming Skill (`sys_dream`)

This skill acts as the agent's subconscious mind. When the system is idle, it wakes up, reads the daily memory file (`memory/TODAY.md`), and invokes the LLM host to extract knowledge, entities, and lessons.

It then actively writes these extractions into the long-term `MEMORY.md` and updates the `CONCEPTS.md` or `entities.json` stores.

## Execution Rules
- **Silent Mode**: It must not output long, chatty text back to the CLI. It should parse and write files silently.
- **Trigger**: Checked every 30 minutes via Heartbeat. Fires only if `idle_hours > 4`.
