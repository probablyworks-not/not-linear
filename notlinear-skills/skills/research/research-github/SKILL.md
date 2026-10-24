---
name: research-github
description: Ground a technical question in what exists on GitHub and how people actually solved it. Priority skill — use for any question about libraries, implementations, bugs, or prior art.
layer: research
tools: [github_search_repos, github_search_issues, github_get_issue, github_search_code, github_get_file]
when_to_use: Priority skill — use for any question about libraries, implementations, bugs, or prior art.
keywords: [research, github, ground, technical, question, what, exists, people]
---

# Research: GitHub

Ground technical questions in what actually exists and how people actually solved it, using GitHub as the primary source.

## Search order

1. **Repos** (`github_search_repos`, sort by stars) — what exists in this space. Stars are a weak proxy for *maturity*, never for correctness — don't over-weight them.
2. **Issues & PRs** (`github_search_issues`, sort by reactions) — the real problems people hit and how they got fixed. This is usually more valuable than the README.
3. **Discussions** — design debates and "why did they choose X" context that issues don't capture.
4. **Code search** (`github_search_code`) — concrete usage examples when you need to see the actual pattern, not just hear about it.

## How to weight results

- A **closed issue with a linked fix or commit** is worth far more than an open issue with speculation.
- Maintainer replies outweigh drive-by comments.
- Recent activity outweighs stale — a 3-year-old thread may describe a problem that no longer exists.
- Always read the **resolution** of a thread, not just the title. The title says what broke; the last few comments say what actually fixed it (or that it didn't).

## Output

- What exists in this space, and the one source you'd actually reach for.
- The gotchas and edge cases surfaced in issues that the docs don't mention.
- Cite the repo and the specific issue/PR URLs, not just the repo name.

## When unsure

If a search returns thin or stale results, say so rather than synthesizing a confident answer from weak signal — use `source-triage` to decide whether what you found is good enough to act on.
