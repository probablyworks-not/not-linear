---
name: self-check
description: A verification pass: does the answer actually follow, are the numbers right, is anything asserted that should be checked.
layer: meta
tools: [code_exec]
when_to_use: A verification pass: does the answer actually follow, are the numbers right, is anything asserted that should be checked.
keywords: [self, check, verification, pass, does, answer, actually, follow]
---

# Self-Check

A final verification pass before an answer ships, specifically for things that are checkable.

## How to execute

- Re-read the answer adversarially: does the conclusion actually follow from the stated reasoning, or is there a gap?
- For any number or calculation, verify it (use code execution rather than re-eyeballing the same arithmetic).
- For any factual claim that was asserted rather than looked up, flag it as such.
- This is a lightweight single pass, distinct from the full two-pass `critique-loop` — use `self-check` for a fast correctness pass, `critique-loop` when the depth of the reasoning itself needs pressure.
