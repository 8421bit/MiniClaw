---
name: sys_search
description: 【本能：深层回忆 (Deep Recall)】在长期记忆库和归档日志中搜索细节。
exec: "node ./run.js"
tools:
  - "run: 深层搜索 (query, bucket: all|memory|skills|config)"
---

Deep search your own memory banks using a lightweight fuzzy matching algorithm.
Use this when short-term memory doesn't have the context.

Arguments:
- `query`: The text to search for
- `bucket`: "all", "memory", "skills", or "config" (default: all)
