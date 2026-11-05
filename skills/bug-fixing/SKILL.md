---
name: bug-fixing
description: Investigate regressions in the current web/ application, selecting the feature-specific skill first. The historical checklist below applies only to the legacy frontend/ application.
---

# Scope and routing

The active application is React/TypeScript under `web/`, built with Vite. The historical vanilla-JS app is not the current Canvas implementation. Do not infer that Canvas uses `threadState`, `persistAll`, `openBranch`, legacy DOM panels, or the old no-build workflow.

For Canvas work, read [Canvas branch system](../canvas-branch-system/SKILL.md) and inspect current callers and types. For chat branches in React, inspect `web/src/branch/` and `web/src/db/branch-ops.ts`; do not apply legacy function contracts to them. For other React features, inspect their own store/repository and tests.

The material below is historical guidance for `frontend/` only. Preserve it for legacy maintenance; do not apply it to `web/`.

---


# Bug fixing procedure

Follow these steps in order. Do not skip step 1 or step 5.

## 1. Read `BUGS.md` first

Before reading any code, read the **Fragile areas** section of `BUGS.md`. If the bug you are about to fix touches a listed fragile area, also read every prior bug entry tagged to that area. You are looking for: what previously broke, what fix was applied, and which test case the previous fix passed. Your fix must not regress any of those test cases.

## 2. Reproduce before you fix

Write the manual reproduction steps in your reasoning before touching code. If you cannot reproduce the bug from the description, ask the human for clarification. Fixing a bug you cannot reproduce produces a fix you cannot verify.

## 3. Find the root cause, not the symptom

State explicitly: "The symptom is X. The root cause is Y." If you cannot articulate the root cause, you have not understood the bug yet — keep reading the code. Symptom-only fixes are how the same bug recurs under a different surface area weeks later.

## 4. Make the smallest fix that addresses the root cause

Do not refactor surrounding code. Do not "improve" things. Do not rename. Do not restyle. Every additional change is a chance to introduce a new bug that the human reviewer has to catch. If you notice an unrelated issue, add an `Observed:` line to the changelog entry instead of fixing it.

## 5. Update `BUGS.md` in the same change set

Append a new numbered entry. Required fields:

- Date discovered, date fixed, agent name
- **Symptom:** what the user saw
- **Root cause:** what was actually wrong (be technical and specific — name the function, the line of logic, the missing check)
- **Fix:** what changed and why this approach over alternatives
- **Files touched**
- **Manual test case:** numbered steps a human can run in 60 seconds to verify the fix
- **Related:** other bug numbers in the same area

If the same area now has 2+ bugs in `BUGS.md`, also add it to or update the **Fragile areas** section at the top of the file.

## 6. Update `CHANGELOG.md`

Standard entry. If your fix changed any user-visible behavior beyond just "thing now works," add a `Behavior changes:` line.

## Anti-patterns

- **"While I was in there..."** — No. Stay in scope. File a separate observation in the changelog under `Observed:`.
- **Fixing the test case instead of the code** — If your fix only works for the exact reproduction steps but breaks variants, you fixed the symptom.
- **Defensive `if (x)` everywhere** — Adding null checks to silence the error is not a fix. Find why `x` was unexpectedly null.
- **"This is a one-line change so it doesn't need a `BUGS.md` entry"** — Yes it does. The next agent needs to know.
- **Symptomatic naming** — A `BUGS.md` title like "branch panel weirdness" is useless. Name the symptom precisely so it's findable later.
