---
name: debug-reasoning
description: Structured debugging: reproduce, isolate, hypothesize, test. Resist jumping to the first plausible cause.
layer: technical
tools: [code_exec]
when_to_use: Structured debugging: reproduce, isolate, hypothesize, test. Resist jumping to the first plausible cause.
keywords: [debug, reasoning, structured, debugging, reproduce, isolate, hypothesize, test]
---

# Debug Reasoning

Structured debugging discipline — resist the pull toward the first plausible-sounding cause.

## How to execute

1. **Reproduce** — get a minimal, reliable repro before theorizing. If you can't reproduce it, say that's the actual first problem.
2. **Isolate** — narrow down which component/layer the bug lives in through bisection, not guessing.
3. **Hypothesize** — form a specific, falsifiable hypothesis about the cause.
4. **Test it** — verify the hypothesis directly (read the actual code path, run a check, use code-exec to confirm an assumption) rather than asserting it's probably right.
5. Only propose a fix once the cause is confirmed, not suspected.

## Discipline

Naming a plausible cause is not the same as confirming it. If time-constrained, say explicitly "this is my best hypothesis, unconfirmed" rather than presenting a guess as a diagnosis.
