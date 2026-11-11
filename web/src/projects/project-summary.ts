import type { PersistedProject, PersistedThread } from '../db/types';
import type { LegacyNote } from '../notes/types';
import { threadTouchedAt } from '../shell/recency';
import { ARTIFACT_KIND, type ArtifactKind, type ProjectArtifact } from './extras/types';

// Pure derivations for the project screen, so the counts, empty flags and dates are testable on their own.

const DAY = 86_400_000;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Chat-row time: `2h`, `Mon`, `Oct 14` (and the year once it is not this one). */
export function shortTime(ts: number | undefined, now: number = Date.now()): string {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h`;
  const d = new Date(ts);
  if (diff < 7 * DAY) return WEEKDAY[d.getDay()]!;
  const date = `${MONTH[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? date : `${date}, ${d.getFullYear()}`;
}

/** Card and meta time: `just now`, `2h ago`, `3d ago`, `2w ago`, then a date. */
export function ago(ts: number | undefined, now: number = Date.now()): string {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < 35 * DAY) return `${Math.floor(diff / (7 * DAY))}w ago`;
  return shortTime(ts, now);
}

export interface ChatRow { id: string; title: string; subtitle: string; branchCount: number; updatedAt: number }

function lastText(t: PersistedThread): string {
  const msgs = Array.isArray(t.mainMessages) ? t.mainMessages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as { role?: string; content?: unknown };
    if (m?.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content.replace(/\s+/g, ' ').trim().slice(0, 140);
  }
  return '';
}

/** The project's chats as rows, most recently active first. Threads from before `updatedAt` existed sort last. */
export function chatRows(threads: Record<string, PersistedThread | undefined>, ids: readonly string[]): ChatRow[] {
  const rows = ids.map((id): ChatRow => {
    const t = threads[id] ?? {};
    return {
      id, title: t.title || 'Untitled chat', subtitle: lastText(t),
      branchCount: Object.keys(t.branchSnapshots ?? {}).length,
      updatedAt: threadTouchedAt(t),
    };
  });
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const noteTitle = (n: LegacyNote): string => (typeof n.title === 'string' && n.title ? n.title : 'Untitled');
export const isPinned = (n: LegacyNote): boolean => n.pinned === true;

/** First line of text in a note's blocks, for its card. */
export function notePreview(n: LegacyNote): string {
  const walk = (blocks: unknown): string => {
    if (!Array.isArray(blocks)) return '';
    for (const b of blocks as Array<Record<string, unknown>>) {
      const text = typeof b.text === 'string' ? b.text : typeof b.html === 'string' ? b.html.replace(/<[^>]*>/g, '') : '';
      if (text.trim()) return text.replace(/\s+/g, ' ').trim();
      const inner = walk(b.children);
      if (inner) return inner;
    }
    return '';
  };
  return walk(n.blocks).slice(0, 160);
}

export type NoteFilter = 'all' | 'pinned';
/** Pinned first, then most recently edited. */
export function filterNotes(notes: readonly LegacyNote[], filter: NoteFilter): LegacyNote[] {
  const list = filter === 'pinned' ? notes.filter(isPinned) : [...notes];
  const at = (n: LegacyNote): number => (typeof n.updatedAt === 'number' ? n.updatedAt : 0);
  return list.sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || at(b) - at(a));
}

export type ArtifactFilter = 'all' | ArtifactKind;
export const filterArtifacts = (list: readonly ProjectArtifact[], f: ArtifactFilter): ProjectArtifact[] =>
  (f === 'all' ? [...list] : list.filter(a => ARTIFACT_KIND[a.type] === f)).sort((a, b) => b.updatedAt - a.updatedAt);


export interface ProjectCounts { chats: number; notes: number; artifacts: number; files: number }
export const itemCount = (c: ProjectCounts): number => c.chats + c.notes + c.artifacts + c.files;

/** `61 items · active 2h ago`, or the brand-new line when nothing is in the project yet. */
export function metaLine(c: ProjectCounts, project: Pick<PersistedProject, 'updatedAt'>, now: number = Date.now()): string {
  const n = itemCount(c);
  if (n === 0) return 'Just created · nothing here yet';
  const when = ago(project.updatedAt, now);
  return `${n} item${n === 1 ? '' : 's'}${when ? ` · active ${when}` : ''}`;
}
