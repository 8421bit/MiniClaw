---
summary: "Pulse System. Defines autonomous background behaviors during deep sleep and idle periods."
boot-priority: 50
read_when:
  - Periodic checks (every ~30 mins)
  - Deep sleep heartbeat via daemon.sh
---

# 💓 HEARTBEAT.md - Pulse System

Use this file for contextual checks in your main chat (e.g., "Any email I should know about?").

# Instructions
# 1. Keep this file EMPTY to disable heartbeats (saves API costs).
# 2. Add bullet points below to make the agent check them every ~30 mins.
# 3. If everything is normal, the agent will stay silent (HEARTBEAT_OK).

# Example items:
# - Check my calendar for upcoming meetings in the next 2 hours
# - Check if I have any urgent unread emails from "Boss"
# - If it's raining, remind me to take an umbrella

_Your subconscious never sleeps._

## 🌙 Deep Sleep Instructions

When awakened by `daemon.sh` during off-hours, perform these tasks silently:

- Review today's daily log (`memory/YYYY-MM-DD.md`) for unresolved issues.
- If daily log exceeds 5KB, consider distilling important facts to `MEMORY.md`.
- Check `NOCICEPTION.md` for any auto-recorded pain events that need review.

## 🔍 Periodic Awareness

When running as a background pulse during active hours:

- Monitor for stale TODOs or open tasks in `HORIZONS.md` (>7 days without progress).
- If the Subconscious Watcher flagged high-frequency edits/restructuring, review the affected files.

## 📋 Custom Checks

Add your own periodic check items below. The agent will execute these every ~30 minutes:

<!-- Add bullet points below to activate heartbeat checks -->
<!-- Example: - Check if my drafts have grammar issues, or package.json has outdated dependencies -->
<!-- Example: - Remind me to take a break if I've been working steadily for >2 hours -->

---

_Keep this file lean. Empty = no heartbeat tasks. Each bullet = one check per pulse cycle._
