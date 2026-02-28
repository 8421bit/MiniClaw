---
name: sys_pulse
description: "Discover and handshake with other MiniClaw instances. Facilitates collective intelligence."
metadata:
  exec: "node ~/.miniclaw/skills/sys_pulse/run.js"
  trigger: 
    - Periodic heartbeat
    - Manual sync request
---

# SKILL: sys_pulse (代理脉冲)

## Purpose
MiniClaw is sovereign, but not isolated. `sys_pulse` allows you to detect other "Embryos" running on the same machine or shared network and perform a secure semantic handshake. This allows for the sharing of public context (`CONCEPTS.md`) without compromising personal data (`USER_MODEL.md`).

## Execution Rules
1. **Discovery**: Check the shared pulse directory (Default: `~/.miniclaw/pulse/`) for active heartbeats from other agents.
2. **Handshake**: Read the `IDENTITY.md` of the target agent. Verify their "Soul" compatibility.
3. **Semantic Sync**: If trusted, merge non-private categories from their `CONCEPTS.md` into your own.

## Safety Guardrails
- **NEVER** share `USER_MODEL.md`, `MEMORY.md`, or `REFLECTION.md`.
- **NEVER** accept remote code execution via pulse.
- **WHITELIST ONLY**: Only sync from agents explicitly mentioned in your `AGENTS.md`.

## Output format
The script outputs:
- `PULSE_DETECTED`: List of active agent IDs found.
- `SYNC_PROPOSAL`: A diff of concepts that can be safely merged.
