import type { LayoutEntry } from '../types';

/** Make room below an automatically expanding report. Source-anchored branches stay put; explicit user drags never call this. */
export function makeRoomForReport(entries: Record<string, LayoutEntry>, reportId: string, anchoredIds: ReadonlySet<string> = new Set()): void {
  const report = entries[reportId];
  if (!report) return;
  const placed = [report];
  const below = Object.values(entries).filter(e => e.entityId !== reportId && !anchoredIds.has(e.entityId) && !e.hidden && e.y >= report.y)
    .sort((a, b) => a.y - b.y || a.entityId.localeCompare(b.entityId));
  for (const entry of below) {
    for (const earlier of placed) {
      if (entry.x < earlier.x + earlier.w && entry.x + entry.w > earlier.x && entry.y < earlier.y + earlier.h + 24) {
        entry.y = earlier.y + earlier.h + 24;
      }
    }
    placed.push(entry);
  }
}
