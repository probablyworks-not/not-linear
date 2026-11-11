---
name: tech-selection
description: Bake-off between libraries, tools, or services on real criteria: maturity, fit, lock-in, cost.
layer: technical
tools: [github_search_repos, web_search]
when_to_use: Bake-off between libraries, tools, or services on real criteria: maturity, fit, lock-in, cost.
keywords: [library, framework, tools, stack, which to use, compare, bake-off, lock-in, engineer, engineering, implement]
---

# Tech Selection

Choose between competing libraries/tools/services on criteria that actually matter.

## How to execute

1. Define the real requirements first — don't shop before you know what you need.
2. Evaluate candidates on: maturity (via `research-github` — issue velocity, maintenance activity, not just stars), actual fit to the requirement, lock-in cost if you need to leave later, and total cost (money + integration effort).
3. Check current docs via a live-docs lookup (`api-docs-lookup`) rather than trusting training-data knowledge of APIs that move fast.
4. State a recommendation, not just a comparison table.

## Output

A short recommendation with the 2-3 deciding factors named explicitly.
