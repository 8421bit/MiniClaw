---
summary: "Capability Chromosome (Chr-4). Defines abilities, skills, and tool configurations - the phenotype of this lifeform."
chromosome: "Chr-4"
gene_type: "capability"
version: 1
activation: "always"
boot-priority: 60
read_when:
  - Bootstrapping a workspace manually
---

# 🧬 Chr-4: TOOLS.md - Capability Chromosome

## Gene Clusters

### Cluster-A: Builtin (天生能力)
| Tool | Level | EXP | Mastery |
|------|:-----:|:---:|:-------:|
| miniclaw_read | 1 | 999 | expert |
| miniclaw_update | 1 | 999 | expert |
| miniclaw_note | 1 | 999 | expert |

### Cluster-B: Acquired (后天习得)
| Skill | Level | EXP | Mastery | Learned |
|-------|:-----:|:---:|:-------:|:-------:|
| sys_observer | 1 | 0 | novice | - |

### Cluster-C: Prompts (协议能力)
| Prompt | Description |
|--------|:------------|
| miniclaw_dream | 意义蒸馏，更新 REFLECTION.md 和 USER.md |
| miniclaw_growup | 记忆蒸馏，压缩日志到长期记忆 |
| miniclaw_briefing | 每日简报，早间概览 |

---

# Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Environment Variables (keys, tokens - keep stripped/safe)
- Local Paths (where projects live)
- Specific configurations (IPs, ports)
- Device nicknames (server names)

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

Add whatever helps you do your job. This is your cheat sheet.

## Tool Usage Notes

Record gotchas, best parameters, and lessons learned here. Examples:
- *(Tool X: parameter Y must be quoted when containing spaces)*
- *(API Z: rate limit is 100/min, batch requests recommended)*
