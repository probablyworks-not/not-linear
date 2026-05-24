# Branch system: failure modes

Read this when investigating a bug in the branch system, or when changing code in an area that has previously broken. Each entry walks through *why* a bug happened, not just what was fixed — the goal is to teach the next agent the failure mode so they don't reintroduce it under a different surface.

For the canonical bug records (with test cases and resolution dates), see `BUGS.md`.

## #002 — Branch markers inside panels did not reopen child branches

**The trap:** When the single-instance panel rule was introduced (#004), the existing branch-marker click handler was written assuming markers only appeared in the main chat, where the click would always be opening a branch for the first time. Inside a branch panel, the same marker syntax could now refer to a *child* branch — and the handler resolved the ID against the wrong registry, producing a no-op.

**Why it kept slipping through:** The bug only fires when a branch panel is open and the user clicks a marker *inside* it. Most manual testing creates a branch and reads the response — it doesn't create a child of an existing branch and try to navigate around the tree.

**Lesson:** Any change to click handling for branch markers must be tested at every depth: top-level, inside-a-branch, inside-a-child-of-a-branch. The "click works on a marker in the main chat" smoke test is insufficient.

## #004 — Multiple panels for the same branch

**The trap:** `openBranch` originally created a fresh panel every time it was called. The flow worked when each branch had a unique entry point. Once branches could be opened from three different surfaces (highlight, recents sidebar, context tree), the same branch could be opened twice — and now there were two divergent panels for the same underlying state.

**Why it kept slipping through:** Two panels look fine until the user types in one and switches to the other. Then changes appear lost. The reproduction requires hitting two different entry surfaces for the same branch in one session.

**Lesson:** Whenever a piece of UI state has multiple entry points, the entry-point code must converge on a single coordination function. `openBranch` is now that function. Adding a fourth entry point in the future means routing it through `openBranch`, not adding a parallel path.

**Side effect:** Fixing #004 introduced #002. When you change coordination logic, audit every consumer of the changed contract — the change can re-break things that previously relied on the old behavior.

## #008 — Branch chat lost on chat switch

**The trap:** Chat switches updated `currentThreadId` and re-rendered the main chat area. The in-memory branch state for the *old* thread was still in `threadState`, but it was the live edits — not yet snapshotted to the persisted store. When the user came back, the load path read from the persisted store and saw an empty branch.

**Why it kept slipping through:** If the user switches chats with no open branches, no problem. If the user has an open branch but the snapshot happened to fire from another path (e.g., a message send that triggered `persistAll`), no problem. The bug only fires for a branch that has live unsaved edits at the moment of switch — common, but easy to miss in casual testing.

**Lesson:** The "snapshot before switch" rule (`syncOpenBranchSnapshots`) is a global invariant. If a new code path ever changes `currentThreadId`, it must call snapshot first. Searching for assignments to `currentThreadId` is a useful audit when working in this area.

## #009 — Quote-only reopen overwrote saved branches

**The trap:** When a user clicks a highlight in the parent text, the branch open path used to assume "no branch ID supplied = fresh branch." But if a branch had previously been created from that highlight and snapshotted, the snapshot existed in the store — keyed by quote/anchor, not by an ID the click handler had access to. The handler reset state and the snapshot was overwritten on next save.

**Why it kept slipping through:** Required a specific sequence — create branch via highlight, send messages, close panel, click the original highlight again. Most users either don't close branch panels mid-conversation or use the Recents sidebar to reopen.

**Lesson:** The presence or absence of a `bid` in the call site is not a reliable indicator of fresh-vs-reopen intent. The snapshot store must be checked by *every* path that could be reopening a previously-snapshotted branch — including paths that look like first-time opens. The general rule: prefer to discover an existing snapshot, and only reset when the call site explicitly says `fresh: true`.

## Pattern across all four

Every one of these had the same shape: a single user-visible action (click marker, open branch, switch chat, click highlight) routed through code that *almost* handled it, with one unhandled edge case. The fixes all narrowed the edge case. The next bug in this area will probably look similar — an entry point you didn't think to test, a state you didn't think could exist, an interaction with a feature added later.

When working in branch code, ask: "What is every way the user could reach this code path?" not "What is the way I'm currently testing?"
