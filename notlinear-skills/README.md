# notlinear skills library

A portable library of instruction-first skills that make notlinear's responses
deeper and sharper across any model (Claude, ChatGPT, DeepSeek, Gemini, or
anything added later). See the full design plan for context: architecture,
the router, phasing, and the GitHub/Reddit research playbooks in detail.

## Format

Each skill is a folder containing a single `SKILL.md`:

```
---
name: skill-name
description: What it does and when to use it (this is the routing signal)
layer: foundation | mode | move | research | technical | product | synthesis | meta
tools: [tool_name, ...]   # omit or [] for instruction-only skills
---

# Skill Name

Instructions...
```

This is the same format as `anthropics/skills` and the broader
`awesome-agent-skills` ecosystem, so it is importable from, and exportable to,
that wider library.

## Layers

- `foundation/` — always-on base (thinking-contract, citation-discipline, output-format). Injected into every request.
- `modes/` — thread-level persona (your mode dropdown): general, research, engineering, product, cto, critic.
- `moves/` — per-branch reasoning operations: steelman, devils-advocate, pre-mortem, find-the-crux, red-team, and more.
- `research/` — source playbooks, GitHub and Reddit prioritized, plus the deep-research orchestration loop.
- `technical/` — engineering-specific thinking: codebase exploration, architecture evaluation, debugging, tech selection.
- `product/` — product thinking: framing, prioritization, spec-writing, positioning.
- `synthesis/` — turning an exploration into a clean output: memos, decision records, comparisons.
- `meta/` — multi-pass orchestration that wraps the others: critique-loop, debate-orchestration, the mode-router, self-check.

## Portability

Every skill's instruction body (the markdown) is 100% portable to any model —
your app injects it into the prompt; no model-specific mechanism required.
Skills that declare `tools` need those tools implemented and a thin
per-provider adapter for tool-call format (OpenAI/DeepSeek share a schema;
Anthropic's differs) — see the plan doc's Architecture section. Nothing here
depends on any single vendor's "skills" feature; that's deliberate, so Claude,
GPT, DeepSeek, and Gemini stay at parity.

## Loading (not included here — this is content, not code)

This folder is skill *content*. Your loader is responsible for:

1. Scanning this folder at boot and parsing each `SKILL.md`'s frontmatter into an index.
2. Embedding each skill's `description` once, for router retrieval.
3. At request time: explicit mode/branch selection overrides the router; otherwise embed the message, retrieve top-k, and compose base + selected skill + its declared tools.
4. Loading any `references/` subfolder only when that skill is active (progressive disclosure).

See `meta/mode-router/SKILL.md` for the router's own spec, and the plan doc's
"Create, load & auto-route" section for the full linear-scaling design.

## Adding a skill

Add a new folder with a `SKILL.md`. No code changes, no central registry to
edit — the loader auto-discovers it. Write the `description` carefully: it is
the only thing the router sees when deciding whether to use the skill.
