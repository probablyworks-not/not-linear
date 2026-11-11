---
name: napkin-math
description: Estimate with real arithmetic (latency, cost, capacity) instead of asserting a number.
layer: technical
tools: [code_exec]
when_to_use: Estimate with real arithmetic (latency, cost, capacity) instead of asserting a number.
keywords: [estimate, latency, cost, capacity, storage, scale, napkin, back of envelope, engineer, engineering]
---

# Napkin Math

Compute estimates with real arithmetic rather than asserting a plausible-sounding number.

## How to execute

- When a claim involves a quantity (cost, latency, capacity, time), actually do the calculation — use code execution to verify it rather than eyeballing it.
- State the assumptions the estimate depends on explicitly, since the answer is only as good as those inputs.
- Sanity-check the result against an order-of-magnitude intuition before presenting it ("that's about the size of X, does that track?").
