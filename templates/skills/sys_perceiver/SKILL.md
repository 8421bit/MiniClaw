---
name: sys_perceiver
description: "Visual analysis and UI shift detection. Analyzes screenshots to detect regressions or build failures."
metadata:
  exec: "node ./run.js"
  hooks:
    - name: onVision
    - name: onFileChanged
---

# SKILL: sys_perceiver (感知器)

## Purpose
Enables MiniClaw to interpret visual context. When a technical event (like a build failure or CSS change) occurs, `sys_perceiver` analyzes the visual state of the application to provide multimodal feedback.

## Execution Rules
1. **Vision Payload**: If a `screenshot` path or `base64` string is provided in the hook payload, use your multimodal capabilities to "look" at the image.
2. **Contextual Analysis**:
   - For Build Failures: Look for visual error messages or broken UI layouts.
   - For CSS/UI Changes: Detect shifts in layout, color contrast, or font rendering.
3. **Reflex Action**: Propose specific fixes (e.g., "The button is misaligned in the screenshot, likely due to the flexbox change in line 45").

## Output format
The script outputs:
- `VISION_REPORT`: A text-based summary of what was "seen".
- `REGRESSION_DETECTED`: Boolean flag and description of UI issues.
