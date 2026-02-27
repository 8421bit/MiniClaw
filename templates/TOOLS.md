---
summary: "Environment Config. Records local-specific tool parameters (IPs, paths) for environment adaptation."
boot-priority: 60
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - Local Notes

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
