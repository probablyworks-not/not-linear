---
name: research-reddit
description: Gauge what users actually want, prefer, and complain about, using Reddit. Priority skill for product research and 'what do people think of X' questions.
layer: research
tools: [reddit_find_subreddits, reddit_search, reddit_get_comments]
when_to_use: Gauge what users actually want, prefer, and complain about, using Reddit. Priority skill for product research and 'what do people think of X' questions.
keywords: [research, reddit, gauge, what, users, actually, want, prefer]
---

# Research: Reddit

Gauge what real users want, like, and complain about — Reddit is for *sentiment and lived experience*, not facts.

## Flow

1. **Subreddits**: if the user supplies specific subreddits in the prompt, start there. If not, use `reddit_find_subreddits` to locate the right ones. Either way, also explore adjacent/related subreddits to widen coverage — a given list is a floor, not a ceiling.
2. **Search** (`reddit_search`, sort by top, time=year) — top-of-year surfaces durable, well-vetted opinion. "Hot" surfaces whatever is trending today, which is noisier for research purposes.
3. **Read the comment trees** (`reddit_get_comments`), not just the post. The insight on Reddit lives in the comments — disagreements, corrections, "actually I tried that and..." — not in the original post.
4. **Weight by vote ratio**, not raw score alone — a highly upvoted top comment with a strong counter-reply underneath is more informative than either alone.

## Separating signal from noise

- A recurring theme across multiple independent threads is signal. A single dramatic anecdote is not, however vivid.
- High-voted *specifics* ("switched from X to Y because of Z") are worth more than high-voted *vibes* ("this is amazing").
- Discount venting threads and brigading — read for the substance underneath the frustration, not the frustration itself.
- Note sample bias explicitly: Reddit skews toward a particular kind of user (vocal, online, often technical/early-adopter) — say so when it matters to the conclusion.

## Output

- Themes ranked by frequency × conviction, not just frequency.
- Representative quotes (short, attributed to the thread) rather than paraphrase alone.
- Cite thread URLs and, where a single comment carries the point, the comment itself.
- Name the caveat about sample bias when the finding is being used for a real decision.
