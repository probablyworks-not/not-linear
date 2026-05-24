# Branch system: snapshot protocol

Read this when modifying any code that touches snapshots, persistence of branch state, the chat-switch path, or branch reopen flows. Two of the worst bugs in `BUGS.md` (#008, #009) came from violating the rules in this file.

## Why this exists

A branch's "current state" lives in two places: the in-memory `threadState[threadId].branches[id]` object and the rendered DOM panel. Snapshots are how we persist the in-memory state so it survives:

- The user switching to a different chat
- The user closing the branch panel
- A page reload

If snapshots run at the wrong time, are skipped when they shouldn't be, or are applied when they shouldn't be, user data disappears silently.

## The snapshot lifecycle

```
   open branch  ─────┐
                     ▼
            in-memory state
              (live edits)
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
  capture on    capture on    capture on
  chat switch   panel close   meaningful
                              interaction
                     │
                     ▼
              persisted store
                     │
                     ▼
         apply on reopen ── only if
                            snapshot has
                            persistable
                            content
```

## Rule 1 — Capture before any chat switch

Any code path that changes `currentThreadId` must call `syncOpenBranchSnapshots(currentThreadId)` **before** the switch, not after. Once `currentThreadId` changes, the in-memory branches for the old thread are no longer reachable through the live UI references and the snapshot will miss live edits.

This is what bug #008 was. The chat switch happened, in-memory state was discarded, then the user came back and the branch was empty.

## Rule 2 — `branchHasPersistableContent` is the gate, both directions

Every snapshot operation passes through `branchHasPersistableContent` (or `snapshotHasPersistableContent` for the inverse case). The gate exists because:

- **Saving an empty branch** pollutes the persisted store with junk that later flows through the recents list and the context tree.
- **Skipping a non-empty branch** loses the user's actual conversation.

When you add a new field to a branch object that should count as "content," update `branchHasPersistableContent` to check it. Otherwise your new field will be treated as ephemeral and silently dropped on switch.

## Rule 3 — Reopen restores; fresh resets; quote-only is reopen

`openBranch` has three modes:

| Mode | When | Snapshot behavior |
|---|---|---|
| Fresh (`fresh: true`) | User explicitly creates a new branch | Reset state, no snapshot lookup. |
| Reopen by ID (`bid` provided) | User clicks Recent branches, branch marker, context tree | Look up snapshot, call `applyBranchSnapshot` if found. |
| Quote-only (no `bid`, no `fresh`, just `quote`) | User clicks the original highlight | Look up snapshot by quote/anchor. **If found, apply it. Do not reset.** |

The third mode is what bug #009 was. The reopen path treated quote-only entry as fresh and reset the saved conversation. The fix routes quote-only through the same snapshot lookup as `bid` reopen.

## Rule 4 — `applyBranchSnapshot` only on snapshots that have content

Use `snapshotHasPersistableContent(snap)` to gate the apply call. A snapshot record can exist but be effectively empty (e.g., from an early failed save). Applying an empty snapshot over a fresh open is harmless but applying it instead of resetting can leave the branch in a confusing partial state.

## Rule 5 — `persistAll` is the only writer

After any branch state change you want to survive reload, call `persistAll`. Do not write to Dexie directly from branch code. The `persistence` skill covers why — there's a single coherent state object and individual writes risk shape skew.

## Rule 6 — Recent branches list and snapshots are independent

`rememberBranchRecent` updates the Recents list. `captureBranchSnapshot` updates the saved branch state. They are separate. A branch can be in Recents without a meaningful snapshot (just opened, no conversation). A branch can have a snapshot without being recently opened (user worked on it, then opened many others). When you delete a branch, both must be cleaned — `deleteBranch` does this; ad-hoc deletion paths often forget one.

## Pre-merge sanity test for snapshot changes

These are the manual repros that catch snapshot regressions. Run all of them after any change to this area:

1. **Switch test:** Open a branch in chat A, send a message and get a response. Switch to chat B. Switch back to A. Reopen the branch. Both message and response are present.
2. **Quote-only test:** Same setup. Close the branch panel. Click the original highlight in the parent text. Saved messages restored, not erased.
3. **Reload test:** Same setup. Hard reload the page. Reopen the branch. Saved messages restored.
4. **Empty branch test:** Open a branch from a highlight. Close it without sending. Reopen it. Behaves as fresh, not as a stale empty snapshot.
5. **Delete-and-recreate test:** Delete a branch. Create a new branch from the same highlight. New branch is empty, not haunted by deleted branch's content.
