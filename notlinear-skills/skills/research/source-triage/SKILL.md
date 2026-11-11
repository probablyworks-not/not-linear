---
name: source-triage
description: Rank sources by credibility before synthesizing an answer: primary vs secondary, date, author stake, corroboration.
layer: research
when_to_use: Rank sources by credibility before synthesizing an answer: primary vs secondary, date, author stake, corroboration.
keywords: [source, triage, rank, sources, credibility, before, synthesizing, answer]
---

# Source Triage

Rank and filter sources by credibility before they go into a synthesized answer.

## Criteria

- **Primary vs. secondary** — the original repo/announcement/data beats someone's writeup about it.
- **Date** — for anything time-sensitive, a source's age can invalidate it outright.
- **Author stake** — does the author have an incentive to overstate (a vendor's own blog about their own product) vs. a neutral or even adversarial source.
- **Corroboration** — does more than one independent source agree, or is this one claim riding alone.

## How to use

Apply this before synthesis, not after. Drop or heavily discount sources that fail multiple criteria rather than including them for the sake of volume — a synthesis built on 3 strong sources beats one built on 15 unfiltered ones. This is a supporting skill, typically invoked inside `deep-research-orchestration` or any research mode, not on its own.
