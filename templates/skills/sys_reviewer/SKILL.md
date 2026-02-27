---
name: sys_reviewer
description: "Automatically reviews newly created files to provide immediate feedback or categorization."
metadata:
  version: "0.7.0"
  exec: "node ./run.js"
  hooks:
    - name: onFileCreated
---

# 🕵️‍♂️ System Reviewer Reflex (`sys_reviewer`)

This is a reactive skill (reflex) that triggers whenever a new file is created in the MiniClaw environment. 

It analyzes the purpose of the new file and suggests connections to existing domains or flags missing metadata.

## Behavior
- **Trigger**: `onFileCreated`
- **Action**: Read the file, interpret its intent, and log a "conscious" reflection in `REFLECTION.md`.
