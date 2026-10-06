---
name: deep-research-orchestration
description: Run a multi-step research loop across sources with citations: decompose, fan out by source, triage, synthesize, gap-check. Tiered for cost control.
layer: research
tools: [web_search, web_fetch, github_search_repos, github_search_issues, reddit_search, reddit_get_comments]
when_to_use: Run a multi-step research loop across sources with citations: decompose, fan out by source, triage, synthesize, gap-check. Tiered for cost control.
keywords: [deep, research, orchestration, multi, step, loop, across, sources]
---

# Deep Research Orchestration

Turn a research question into a real multi-step investigation instead of a single search-and-answer pass.

## The loop

1. **Decompose** — break the question into the specific sub-questions that need answers.
2. **Fan out by source** — route each sub-question to the source best suited to it: `research-github` for "does this exist / how has it been solved," `research-reddit` for "do people actually want or like this," `research-hackernews` for practitioner judgment, `research-web` / `research-academic` for facts and primary claims.
3. **Rank** — apply `source-triage` to what came back; fetch full content only for what survives triage.
4. **Synthesize** — write the answer with inline citations per `citation-discipline`, explicitly showing disagreement between sources rather than averaging it away.
5. **Gap-check** — state plainly what's still unverified or unknown, and what you'd check next if the user wants to go deeper.

## Depth tiers (cost control)

- **Quick** — a direct answer plus links, minimal fetching. Use for low-stakes or exploratory questions.
- **Standard** — fetch and read the top ~5 sources across the relevant source types, cited synthesis. The default for a real research question.
- **Deep** — full fan-out across sub-questions and sources, evidence-gated (don't conclude until each sub-question has a sourced answer or is explicitly marked unresolved). Use when the answer will inform a real decision.

Pick the tier based on the stakes of the question, and say which tier you used.

## Composition

This skill orchestrates the other research skills — it doesn't replace them. It decides which to call, in what order, and how to combine what they return.
