// Pure logic of the quick-open palette, ported from app.js:6171-6236. Kept free
// of React so each rule can be tested against the legacy behaviour it copies.
//
// Legacy "ranking" is not ranking: it is a case-insensitive substring filter
// that keeps the original order (threads in sidebar order). That is reproduced
// as it is, because "improving" it would change which result Enter opens.

export interface SearchItem {
  kind: 'thread';
  tid: string;
  title: string;
  /** Secondary text, also searchable. Unused until branch results arrive in P5b. */
  sub?: string;
}

/** Empty query keeps everything. Otherwise title or sub must contain the query. */
export function filterItems<T extends { title: string; sub?: string }>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(i => i.title.toLowerCase().includes(q) || (i.sub !== undefined && i.sub.toLowerCase().includes(q)));
}

export interface Highlighted { before: string; match: string; after: string }

/**
 * app.js:6159 highlightMatch. Finds the match in the lower-cased text and slices
 * the ORIGINAL by that index/length, exactly as legacy does (so it shares
 * legacy's behaviour for the few characters whose lower-case differs in length).
 * `query` is used untrimmed here, as in legacy, where only the filter trims.
 */
export function splitHighlight(text: string, query: string): Highlighted {
  if (!query) return { before: text, match: '', after: '' };
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return { before: text, match: '', after: '' };
  return { before: text.slice(0, idx), match: text.slice(idx, idx + query.length), after: text.slice(idx + query.length) };
}

/**
 * Arrow-key movement (app.js:6226-6227). No wrap-around. Starting from "nothing
 * active" (-1), ArrowDown lands on the first result and ArrowUp ALSO lands on
 * the first result, since legacy clamps the minimum to 0 rather than -1.
 */
export function moveActive(current: number, key: 'ArrowDown' | 'ArrowUp', total: number): number {
  if (key === 'ArrowDown') return Math.min(current + 1, total - 1);
  return Math.max(current - 1, 0);
}

/** Enter opens the highlighted result, or the first one if none is. */
export function enterTarget<T>(items: readonly T[], active: number): T | undefined {
  return items[active >= 0 ? active : 0];
}

export const EMPTY_NO_ITEMS = 'No threads or branches yet';
export const emptyForQuery = (q: string): string => `No results for "${q}"`;
export const SEARCH_PLACEHOLDER = 'Search threads and branches…';
