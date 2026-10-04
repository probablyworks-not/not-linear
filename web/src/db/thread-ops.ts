import type { PersistedState, PersistedThread } from './types';

// Pure transformations of the persisted `state` row. No I/O, so every rule the
// legacy app applies when it creates or deletes a thread is unit-testable
// without a database. Each mirrors a specific legacy function; the comment
// names it so a future reader can diff behaviour rather than guess.

/** The four seed threads baked into frontend/index.html. Never in `dynamic`. */
export const STATIC_THREADS: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'doc-main', title: 'Non-linear chat system' },
  { id: 'pricing', title: 'Pricing research' },
  { id: 'onboarding', title: 'Onboarding flow review' },
  { id: 'planning', title: 'Q3 planning notes' },
];
export const STATIC_THREAD_IDS: ReadonlySet<string> = new Set(STATIC_THREADS.map(t => t.id));
export const MAIN_THREAD_ID = 'doc-main';

/** A state row for a database the legacy app has never written to. */
export function emptyState(): PersistedState {
  return {
    threads: {},
    current: MAIN_THREAD_ID,
    dynamic: [],
    deletedThreads: [],
    chatCount: 1,
    projects: {},
    projectCount: 1,
    prefs: {},
  };
}

/** app.js:1208-1218 — whitespace-normalised title, with a fallback. */
export function cleanThreadTitle(text: unknown, fallback = 'Untitled chat'): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim() || fallback;
}

export function isUntitledTitle(title: unknown): boolean {
  return /^Untitled chat(?: \d+)?$/i.test(cleanThreadTitle(title));
}

function textFromHtml(html: unknown): string {
  const el = document.createElement('div');
  el.innerHTML = typeof html === 'string' ? html : '';
  return cleanThreadTitle(el.textContent, '');
}

/** app.js:1235 resolveThreadTitle. An untitled chat borrows its h1, once it has one. */
export function resolveThreadTitle(thread: PersistedThread | undefined, fallback: string): string {
  const stored = cleanThreadTitle(thread?.title || fallback);
  if (thread && thread.kind !== 'doc' && isUntitledTitle(stored)) {
    const h1 = textFromHtml(thread.h1);
    if (h1 && !isUntitledTitle(h1)) return h1;
  }
  return stored;
}

/** app.js:1305 blankDocContent. */
export const BLANK_DOC_CONTENT = '<p><br></p>';

/**
 * app.js:1543 startNewChat. Mutates `state` and returns the new thread's id.
 * The thread object has exactly the fields legacy gives it — `stream` is the
 * rendered-HTML field, empty for a new chat.
 */
export function createThreadIn(state: PersistedState, now: number): string {
  const id = `chat-${now}`;
  const title = state.chatCount <= 1 ? 'Untitled chat' : `Untitled chat ${state.chatCount}`;
  state.chatCount += 1;
  state.threads[id] = {
    kind: 'chat',
    title,
    stream: '',
    docContent: BLANK_DOC_CONTENT,
    tokenIn: 0,
    tokenCacheHit: 0,
    tokenOut: 0,
    cost: 0,
    highlights: [],
    branchSnapshots: {},
    branchRecents: {},
  };
  state.dynamic.push({ id, title });
  state.current = id;
  return id;
}

/**
 * app.js:1514 deleteThread, minus the confirm and the abort of in-flight
 * streams (the caller owns the former; P3 has no streams). Returns false for
 * the one thread that can never be deleted.
 *
 * The id goes into `deletedThreads` so a stale tab restored from `nl_tabs_v1`
 * knows to drop it instead of resurrecting it.
 */
export function deleteThreadIn(state: PersistedState, id: string): boolean {
  if (!id || id === MAIN_THREAD_ID) return false;
  delete state.threads[id];
  if (!state.deletedThreads.includes(id)) state.deletedThreads.push(id);
  state.dynamic = state.dynamic.filter(d => d.id !== id);
  if (state.current === id) state.current = MAIN_THREAD_ID;
  return true;
}

export interface ThreadRow {
  id: string;
  title: string;
  emoji?: string;
  unread: boolean;
  isStatic: boolean;
}

/**
 * The sidebar's thread list: seeds first, then dynamic threads in creation
 * order, with deleted ones removed. Same order the legacy DOM ends up in
 * (addThreadButton appends to #threads-list).
 */
export function visibleThreads(state: PersistedState): ThreadRow[] {
  const deleted = new Set(state.deletedThreads);
  const seen = new Set<string>();
  const rows: ThreadRow[] = [];
  const push = (id: string, fallback: string, isStatic: boolean): void => {
    if (deleted.has(id) || seen.has(id)) return;
    seen.add(id);
    const thread = state.threads[id];
    const emoji = typeof thread?.emoji === 'string' && thread.emoji ? thread.emoji : undefined;
    rows.push({ id, title: resolveThreadTitle(thread, fallback), emoji, unread: thread?.unread === true, isStatic });
  };
  for (const t of STATIC_THREADS) push(t.id, t.title, true);
  for (const d of state.dynamic) push(d.id, d.title, false);
  return rows;
}
