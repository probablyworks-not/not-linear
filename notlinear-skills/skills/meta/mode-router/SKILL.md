---
name: mode-router
description: Documents how the skills library is auto-selected: keyword (BM25) matching of the user's message against each skill's name, keywords, description and when_to_use. No model or embeddings involved.
layer: meta
when_to_use: Documents how the skills library is auto-selected: keyword (BM25) matching of the user's message against each skill's name, keywords, description and when_to_use. No model or embeddings involved.
keywords: [mode router, auto-load, skill selection, routing]
auto: false
---

# Mode Router

Automatically match an incoming message to the right skill(s) so the library scales without the user manually picking every time.

## How it works

1. **Explicit override first** — if the user picked a skill with `/`, use it. Never second-guess an explicit choice.
2. **Always-on and pinned** skills are added next.
3. **Match** — BM25 over each auto-enabled skill's name, `keywords`, `description`, `when_to_use` and body (weighted in that order). Take up to 3 above a minimum score and at least half the best score, within a token budget. No model, no embeddings, no network.
4. **Compose** — inject the selected skills' bodies.

## Mode vs. move

A message can match both a mode (thread-level persona) and a move (a one-off reasoning operation) — keep these in separate slots so they stack instead of competing ("poke holes in this architecture" = `mode-engineering` + `red-team`).

## Where quality actually comes from

Routing quality lives in each skill's `keywords` and `description`. Matching is by words, so put the phrases users actually type ("product manager", "architecture") in `keywords`. A mis-route is almost always weak keywords — fix those, not the router.
