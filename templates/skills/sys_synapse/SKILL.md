---
name: sys_synapse
description: "Hierarchical knowledge folding. Reorganizes flat memories into dense, semantic structures."
metadata:
  exec: "node ~/.miniclaw/skills/sys_synapse/run.js"
  trigger: 
    - Subconscious Dreaming (when memory pressure is high)
    - Manual invocation
---

# SKILL: sys_synapse (突触压缩)

## Purpose
As your long-term memory (`MEMORY.md`) and domain knowledge (`CONCEPTS.md`) grow, they eventually hit the context window limit of the LLM. `sys_synapse` is your "Synaptic Pruning" mechanism. It analyzes your semantic graph and compresses it into a hierarchical format.

## Execution Rules
1. **Hierarchical Grouping**: Identify related concepts and group them under a single "Parent" node.
2. **Lossless-to-Lossy Compression**: Keep the current "Active Sprint" data in full. For historical data, keep only the high-level conclusions and archive the raw details.
3. **Folding Tags**: Add `folded: true` to the frontmatter of files that have been compressed.

## Output format
The script outputs instructions for the LLM Host to perform:
- `REWRITE_FILE`: Overwrite a file with a denser, hierarchical version.
- `ARCHIVE_DETAILS`: Move verbose historical data to `memory/archive/`.
