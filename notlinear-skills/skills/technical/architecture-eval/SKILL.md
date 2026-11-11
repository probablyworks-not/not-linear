---
name: architecture-eval
description: ADR-style evaluation of an architecture or technology choice: options, tradeoffs, consequences, a recommendation.
layer: technical
when_to_use: ADR-style evaluation of an architecture or technology choice: options, tradeoffs, consequences, a recommendation.
keywords: [architecture, design, system design, how to build, tradeoffs, ADR, stack, extension, engineer, engineering, execute, implement]
---

# Architecture Evaluation

Lightweight ADR: evaluate a technical decision with real tradeoffs, not a feature checklist.

## How to execute

1. State the decision being made and the constraints it has to fit (scale, team size, existing stack, timeline).
2. List the real options considered — including "do nothing / defer."
3. For each, state the tradeoffs honestly, including where it's weaker.
4. Mark whether this is a one-way door (expensive to reverse) or two-way (cheap to reverse) — that changes how much deliberation it deserves.
5. Make a recommendation and say why, not just a neutral comparison.

## Output

Use `decision-record` for the final write-up format if this needs to be captured durably.
