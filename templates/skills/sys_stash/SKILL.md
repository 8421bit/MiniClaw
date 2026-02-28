---
name: sys_stash
description: "【跨会话状态快照 (Session Stash)】用于在不同会话之间暂存和恢复关键上下文状态。"
metadata:
  exec: "node ~/.miniclaw/skills/sys_stash/run.js"
  tools:
    - "run: 暂存管理 (action: save|load|list|clear, key, value)"
---

This tool manages the session stash `STASH.json`. Active stash contents are injected into the highest priority context section upon booting.

Usage arguments:
- `action`: "save", "load", "list", "clear"
- `key`: string (for save/load)
- `value`: any custom JSON object or string (for save)
