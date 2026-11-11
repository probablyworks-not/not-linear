---
name: debate-orchestration
description: Two models argue opposing sides of a question, a third pass synthesizes and names the crux. Requires multi-model routing.
layer: meta
tools: [multi_model_router]
when_to_use: Two models argue opposing sides of a question, a third pass synthesizes and names the crux. Requires multi-model routing.
keywords: [debate, orchestration, models, argue, opposing, sides, question, third]
---

# Debate Orchestration

Run two models against each other on opposing sides of a question, then synthesize.

## How to execute

1. Frame the question and assign opposing mandates: one model argues FOR the strongest case, the other argues AGAINST the strongest case.
2. Run both independently (they should not see each other's argument while constructing their own).
3. Synthesize: judge both arguments honestly — where is each one bluffing or weak, and what's the actual crux the disagreement turns on (pairs with the `find-the-crux` move).
4. Present the synthesis, not just both arguments side by side — the value is in the judgment, not the transcript.

## When to use

Reserve for genuinely contested, high-stakes questions where a single model's answer would likely be too agreeable or too one-sided. This is expensive (3 model calls) — don't use it as a default.
