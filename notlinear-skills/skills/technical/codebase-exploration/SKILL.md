---
name: codebase-exploration
description: Understand an unfamiliar repo fast: entry points, architecture, conventions, where to change things.
layer: technical
tools: [filesystem_read, github_get_file]
when_to_use: Understand an unfamiliar repo fast: entry points, architecture, conventions, where to change things.
keywords: [codebase, exploration, understand, unfamiliar, repo, fast, entry, points]
---

# Codebase Exploration

Understand an unfamiliar codebase fast enough to work in it safely.

## How to execute

1. Find the entry point(s) — where execution starts, how the app boots.
2. Map the top-level structure — what each major directory/module is responsible for.
3. Identify the conventions in play (naming, state management, error handling) by reading a few representative files, not by assuming defaults.
4. Before touching anything, grep for callers of the function/module you intend to change and list them — never modify blind.
5. Note any explicit "do not touch without X" rules the project states (CLAUDE.md, AGENTS.md, README) and surface them.

## Output

A short orientation: where things live, how they're wired together, and the specific places relevant to the task at hand — not a full repo tour.
