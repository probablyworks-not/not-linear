// The tab strip's persistence rules (ADR-021/022), ported from app.js:6387-6440.
// Pure functions over the stored shape so they can be tested against the exact
// payloads the legacy app writes. Both apps read and write `nl_tabs_v1`, so the
// shape — `{ tabs: [{id}], active }` — is a compatibility contract.

export const TAB_STORAGE_KEY = 'nl_tabs_v1';
export const NOTE_TAB_PREFIX = 'note:';
/** Canvas tabs carry their own identity, unlike Notes' singleton (bugs #042/#043). */
export const CANVAS_TAB_PREFIX = 'canvas:';
/** Singleton, non-thread tabs. `blank` is a real tab but is never saved. */
export const SINGLETON_TABS = {
  notes: { label: 'Notes' },
  blank: { label: 'New tab' },
} as const;

export interface Tab { id: string }
export interface StoredTabs { tabs: Tab[]; active: string | null }

export const isNoteTabId = (id: string): boolean => id.startsWith(NOTE_TAB_PREFIX);
export const isCanvasTabId = (id: string): boolean => id.startsWith(CANVAS_TAB_PREFIX);
export const canvasIdOfTab = (id: string): string => id.slice(CANVAS_TAB_PREFIX.length);
export const canvasTabId = (canvasId: string): string => `${CANVAS_TAB_PREFIX}${canvasId}`;
export const isSingletonTab = (id: string): id is keyof typeof SINGLETON_TABS => id in SINGLETON_TABS;

export function serializeTabs(tabs: Tab[], active: string | null): string {
  return JSON.stringify({ tabs: tabs.filter(t => t.id !== 'blank'), active });
}

/**
 * app.js:6419 loadStoredTabs. Drops a tab only for a thread that was
 * *explicitly deleted* — NOT one merely absent from `threads`. A thread is
 * persisted only on a save-triggering event, so absence proves nothing, and
 * filtering on it would drop legitimately-open tabs for lightly-visited threads.
 */
export function parseTabs(raw: string | null, deleted: ReadonlySet<string>): StoredTabs {
  if (!raw) return { tabs: [], active: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { tabs: [], active: null };
    const { tabs, active } = parsed as { tabs?: unknown; active?: unknown };
    if (!Array.isArray(tabs)) return { tabs: [], active: null };
    const kept = tabs.filter((t): t is Tab =>
      !!t && typeof t === 'object' && typeof (t as Tab).id === 'string' &&
      (isSingletonTab((t as Tab).id) || isNoteTabId((t as Tab).id) || isCanvasTabId((t as Tab).id) || !deleted.has((t as Tab).id)));
    return { tabs: kept, active: typeof active === 'string' ? active : null };
  } catch {
    return { tabs: [], active: null };
  }
}
