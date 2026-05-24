# Branch system: function reference

Read this when modifying any function in the branch system. Function names are stable across refactors and greppable.

## Opening and lifecycle

### `openBranch({ quote, parentBranchId, fresh, bid, anchorBid, collapsed, depth })`
The single entry point for opening a branch panel. Single-instance rule: if a panel for this branch ID is already open, reuse it; do not create a duplicate. The reopen path must check `applyBranchSnapshot` before initializing fresh state when `bid` is supplied. (See bug #009.)

### `closeBranch(id)`, `closeAllBranches()`, `closeOtherBranches(keepId)`
The three close paths. All must update the same internal state — never close a panel by removing the DOM node directly.

### `setBranchExpanded(b)`, `syncBranchEmpty(b, empty)`
Visual state toggles. Do not let these diverge from the underlying data.

## Persistence and snapshots

### `captureBranchSnapshot(id, threadId, { force })`
Snapshots a branch's current state into the persisted store. Pass `force: true` only when you need to bypass the persistable-content check (rare).

### `branchHasPersistableContent(b)` and `snapshotHasPersistableContent(snap)`
Gates that determine whether a branch is worth saving. **Do not skip these checks** — saving empty branches pollutes state; not saving non-empty ones loses user data.

### `syncOpenBranchSnapshots(threadId)`
Must be called before any chat switch. Iterates open branches and snapshots those with persistable content. (See bug #008 — this function exists because the original chat-switch path didn't snapshot.)

### `applyBranchSnapshot(b, snap)`
Restores a snapshot onto an open branch. Used by reopen paths.

### `rememberBranchRecent(id, threadId)`
Adds to the Recent branches list and persists. Call this whenever a branch is opened or interacted with meaningfully.

## Deletion

### `deleteBranch(id, threadId)`
The user-facing delete. Must remove from all three surfaces (panel, sidebar, context tree) and persist the removal. **Always go through `deleteBranch`** — never call `removeOpenBranchImmediately` or `removeBranchRecords` directly from UI code.

### `removeOpenBranchImmediately(id, threadId)`, `removeBranchRecords(threadId, ids)`
Internal helpers. Tear down DOM and data respectively. Wrong to call from event handlers — they bypass the coordination `deleteBranch` enforces.

### `branchDeleteTargets(threadId, rootId)`, `branchDeleteTitle(threadId, id)`
Utilities for the delete confirmation dialog.

## Branch context for the model

### `buildBranchContext(id, newUserMsg, buildUserContent)`
Walks the parent chain to assemble the message list sent to the model. The chain must be ordered root → leaf, and each branch contributes its full message list. **Do not summarize the chain** — the model needs the raw context. The system prompt explicitly tells the model the context is complete; if you summarize here, the model gets contradictory signals.

## Markers and click handling

### `unwrapBranchAnchorsInRoot(root, ids)`, `unwrapBranchAnchorsFromHTML(html, ids)`
Reverse the marker wrapping when needed. Use these instead of regex.

### `wrapBranched(range, bid)`
Wraps a selection range with a branch marker. Pair with `unwrapBranchAnchors*` symmetrically.

Marker click handling inside branch panels must resolve nested branch IDs against the same registry used by `openBranch`. (See bug #002.)

## Resize

### `wireBranchResize(el, id)`, `setBranchSize(b, width, height, top)`
Wire up and apply directional resize handles.

### `branchResizeBounds()`, `branchMaxWidth()`, `branchMaxHeight()`
Bounds checks for resize. All directional handles must respect these. (See bug #003.)

## Threading and state init

### `ensureThreadBranchState(threadId)`
Idempotent setup for a thread's branch container. Safe to call multiple times.

### `branchHasHighlights(id, threadId)`
Whether a branch has any highlights still pointing at it. Used in deletion-cascade logic.

### `branchSelector(id)`, `setBranchDepthUI(b)`
DOM helpers — do not embed selectors elsewhere; route through these.

## Send/run path

### `sendBranchMsg(id)`, `continueBranch(id)`, `runBranchTurn(id, text, opts)`
Branch-side equivalents of the main chat send/continue path. They reuse the same model-call infrastructure (see `system-prompt` and `tool-runners` skills).

### `setBranchStreaming(id, v)`, `updateBranchSendState(id)`
UI state during streaming. Must be cleared on error paths too — easy to forget.
