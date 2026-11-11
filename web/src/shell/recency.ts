import type { PersistedThread } from '../db/types';

/** Sidebar lists show this many rows until "Show more" is pressed. */
export const SIDEBAR_VISIBLE = 7;

/** When a chat was last touched: its last turn or its most recently touched branch. 0 for older saves. */
export function threadTouchedAt(t: PersistedThread | undefined): number {
  if (!t) return 0;
  const branchTimes = Object.values(t.branchRecents ?? {}).map(r => (r as { touchedAt?: number }).touchedAt ?? 0);
  return Math.max(typeof t.updatedAt === 'number' ? t.updatedAt : 0, ...branchTimes);
}

/** Most recent first. Array.sort is stable, so rows with no timestamp keep their stored order. */
export function byRecency<T>(items: readonly T[], touchedAt: (item: T) => number): T[] {
  return [...items].sort((a, b) => touchedAt(b) - touchedAt(a));
}
