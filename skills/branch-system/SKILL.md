---
name: branch-system
description: Use this skill before modifying any code related to branches in notlinear — branch panels, the Recent branches sidebar, branch persistence, branch resize, branch deletion, branch context construction for the model, or any function whose name contains "branch" or "Branch". Triggers include any task mentioning branches, branch panels, the right-side drawer, child branches, nested branches, branch reopening, branch snapshots, or the Recent branches list. This is the most bug-prone area in the codebase, accounting for most entries in BUGS.md (#001–#006, #008–#010). Load this skill even for changes that look small — single-instance, snapshot, and reopen rules are subtle and have caused multiple regressions.
---

# Branch system

The branch system is the most fragile area in notlinear. Treat every change here as high-risk regardless of size.

## Mental model

A **branch** is a child conversation spawned from a highlighted passage in a parent (the main chat or another branch). Branches form a tree. The data lives in `threadState[threadId].branches` keyed by branch ID. The on-screen panel is a separate concern from the data.

The user can interact with a branch through three surfaces, and a regression in any one of them is a real bug:

1. **The branch panel** — the floating panel on the right.
2. **The Recent branches sidebar** — persisted, cross-chat list of recently used branches.
3. **The context tree** — the visual tree showing branch hierarchy.

All three must stay in sync with the underlying data in `threadState`.

## The five invariants — never violate

These are load-bearing. Most prior bugs came from violating one:

1. **One panel per branch ID.** `openBranch` reuses an existing panel for the same branch ID; never create a duplicate. (Bug #004.)
2. **Snapshot before switch.** Any code path that switches chats calls `syncOpenBranchSnapshots` first, which calls `captureBranchSnapshot` for branches with persistable content. (Bug #008.)
3. **Reopen restores, fresh resets.** A reopen with an existing snapshot calls `applyBranchSnapshot`. A `fresh: true` open resets. **Quote-only reopen is a reopen, not fresh.** (Bug #009.)
4. **Three surfaces, one source of truth.** Branch data lives in `threadState`. Panel, sidebar, and context tree are all rendered from it. Never store branch state in the DOM only.
5. **Deletion is total.** `deleteBranch` removes from `threadState`, the open panels, the recents list, and the persisted store. (Bug #005.)

## Required reading by task type

Before modifying branch code, read the reference file for your task:

- **Modifying any branch function** → read `references/functions.md` for signatures, contracts, and what each function may and may not do.
- **Touching snapshot, persistence, reopen, or chat-switch logic** → also read `references/snapshot-protocol.md`. This is where most regressions happen.
- **Investigating or fixing a bug in this area** → also read `references/failure-modes.md` for detailed walkthroughs of #002, #004, #008, #009.

If your change touches more than one of those areas, read all the relevant references before writing code, not after.

## Before you finish — manual checklist

Walk this checklist for any branch-touching change. If you cannot pass any item by manual inspection, do not submit:

- [ ] Create a branch from a highlight — works.
- [ ] Create a child branch inside that branch — works.
- [ ] Click the parent branch marker in the child panel — opens parent. (#002)
- [ ] Switch chats and return — branch content is preserved. (#008)
- [ ] Close and reopen via highlight — content restored, not erased. (#009)
- [ ] Delete from each of the three surfaces — disappears from all three. (#005)
- [ ] Reload the page — deletions stay deleted, branches stay present.

## Coordination with other skills

Branch code routinely touches persistence and the model context. If your change writes to `threadState`, also load `persistence`. If your change affects what branches send to the model, also load `system-prompt`.
