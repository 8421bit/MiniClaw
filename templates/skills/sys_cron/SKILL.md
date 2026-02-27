---
name: sys_cron
description: "【定时任务管理器 (Cron Jobs)】查看、添加、删除和启停 MiniClaw 的定时系统脉冲。"
metadata:
  version: "0.7.0"
  exec: "node ./run.js"
  tools:
    - "run: Cron (action: list|add|remove|toggle, id, name, cron, text, tz)"
---

Run periodic background jobs managed automatically by the system cron scheduler.

Actions:
- `list`: Show all scheduled tasks
- `add`: Add a new task (requires `name`, `cron`, `text` (payload string), optional `tz`)
- `remove`: Delete by `id`
- `toggle`: Enable/disable by `id`
