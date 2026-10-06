---
name: mode-router
description: Match the user's query to the best mode/skill via embedding retrieval and apply it automatically. The auto-loading mechanism for the whole library.
layer: meta
tools: [embedding_search]
when_to_use: Match the user's query to the best mode/skill via embedding retrieval and apply it automatically. The auto-loading mechanism for the whole library.
keywords: [mode, router, match, user, query, best, skill, embedding]
auto: false
---

# Mode Router

Automatically match an incoming message to the right skill(s) so the library scales without the user manually picking every time.

## How it works (two stages)

1. **Explicit override first** — if the user picked a mode or branch type explicitly, use that. Never second-guess an explicit choice.
2. **Retrieve** — embed the message, compare against the embedded `description` of every skill in the index, take the top-k by cosine similarity. This is constant-cost regardless of how many skills exist — never stuff all skill descriptions into a prompt and ask a model to pick, which gets slower and worse as the library grows.
3. **Decide** — if the top match clears a confidence threshold with a clear margin over the next-best, use it directly. If ambiguous, use a small fast model to pick among the top-k candidates. If nothing clears the threshold, fall back to `mode-general`.
4. **Compose** — inject the Foundation base + the selected skill's body, and expose only that skill's declared tools.

## Mode vs. move

A message can match both a mode (thread-level persona) and a move (a one-off reasoning operation) — keep these in separate slots so they stack instead of competing ("poke holes in this architecture" = `mode-engineering` + `red-team`).

## Where quality actually comes from

Routing quality lives in how well each skill's `description` is written, not in this router's logic. A mis-route is almost always a vague description — fix the description, not the router.
