---
name: persistence
description: Use this skill before modifying any code that reads or writes persisted state in notlinear. Triggers include any task touching persistAll, loadPersistedState, the Dexie database, the nl_state_v2 constant, localStorage, prefs serialization, the deletedThreadIds set, the threadState save shape, branch snapshots that flow through to disk, or the one-time localStorage→IndexedDB migration. Also load this skill when adding any new field that should survive a page reload, when changing the shape of a persisted object, or when fixing a bug where data is unexpectedly missing or stale after reload. Persistence bugs are silent and lose user data; treat this area with extreme caution.
---

# Persistence

Persistence bugs are silent and catastrophic — users lose data and don't know why until they go looking for it. Treat this area with extreme caution.

## Storage architecture

- **Primary store:** IndexedDB via Dexie. Database `notlinear`, version 1, single object store `kv` keyed by `key`.
- **Active key:** `state` — a single record holding the entire app state object.
- **Legacy:** `localStorage[NL_STORE]` where `NL_STORE = 'nl_state_v2'`. Kept only for one-time migration; `loadPersistedState` reads it once on first load, copies to Dexie, then `localStorage.removeItem`s it.
- **API keys:** stored separately in `localStorage['nl_api_keys']` — not part of the migrated state. See `apiKeys`.

## What gets persisted

`persistAll` writes a single object with these top-level fields:

- `threads` — `threadState`, the per-thread message and branch data.
- `current` — `currentThreadId`.
- `dynamic` — array of `{ id, title }` for non-static threads.
- `deletedThreads` — array of thread IDs the user deleted (so we don't recreate them on load).
- `chatCount` — `newChatCount` for naming.
- `prefs` — a whitelist of preference fields. Note: `thinking` is whitelisted but always reset to `false` on load by design.

## Hard rules

### 1. Schema changes require a migration

Any change to:

- A field name in the persisted object
- The shape of `threadState[*]` or its nested `branches`
- The shape of any branch snapshot
- The Dexie schema (stores, version)

…must include a migration path that reads the old shape and rewrites it to the new shape inside `loadPersistedState`. Tag the changelog entry `[SCHEMA]`.

**Do not silently rename keys.** Users have months of saved state in the old key.

### 2. Never increment the Dexie version casually

Bumping `db.version(N)` triggers a Dexie upgrade transaction. If you do this without a proper upgrade function, you can render existing user data unreadable. If you think you need to bump the version, stop and confirm with the human first.

### 3. Whitelist, don't blacklist, when persisting

`persistAll`'s `prefs` block lists explicit fields. New preference fields must be added here — they will not be persisted otherwise. Conversely, never persist the entire `prefs` object: it may contain transient or sensitive runtime state.

### 4. Deletion must persist

When the user deletes a thread or branch, the deletion must survive a reload. Two patterns are in use:

- Threads: added to `deletedThreadIds`, persisted in `deletedThreads`.
- Branches: removed from `threadState[threadId].branches` and from the Recents list before `persistAll`.

If you add a new deletable entity, follow one of these patterns. Do not invent a third.

### 5. Save on every meaningful change

`persistAll` is cheap (single Dexie put). Call it after any state mutation the user would expect to survive a reload. The `beforeunload` handler also calls `saveCurrentThread`, but do not rely on it as your only save — `beforeunload` is unreliable on mobile and during tab crashes.

## Before you finish

For any change that touches persistence:

- [ ] Reload the page after your change — saved state still loads cleanly.
- [ ] Clean-state test: open in a private/incognito window — first-load behavior works (no migration data exists).
- [ ] If you added a new persisted field, confirm it round-trips: set it, reload, read it back.
- [ ] If you changed any shape, confirm the migration handles the old shape — manually inject an old-shape record via DevTools and reload.
- [ ] Check `BUGS.md` #008 and #009 — both were persistence-adjacent. Confirm your change does not regress them.
