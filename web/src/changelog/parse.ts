// Port of parseStoryChapters (app.js:4382), ADR-018: MECHANICAL grouping, no LLM.
// One chapter per "## <date>" heading in CHANGELOG.md; the narrative is the
// first entry's Summary line verbatim; one item per entry's Summary, tagged by
// keyword. Nothing is written or paraphrased.
//
// Hues are CSS variables (tokens.css) instead of legacy's hex/oklch literals,
// since web/ forbids literal colours. tests/changelog/parse-differential.test.ts
// runs the real legacy function and this one on the same input.

export type Tag = 'Fix' | 'Feature' | 'Improvement';
export type HeroIcon = 'branch' | 'balance' | 'roots' | 'hummingbird';
export type TagIcon = 'star' | 'compass' | 'acorn';

export const STORY_HUES = ['var(--story-hue-1)', 'var(--story-hue-2)', 'var(--story-hue-3)', 'var(--story-hue-4)'] as const;
export const STORY_HERO_ICONS: readonly HeroIcon[] = ['branch', 'balance', 'roots', 'hummingbird'];
export const STORY_TAG_HUES: Record<Tag, { id: TagIcon; color: string }> = {
  Fix: { id: 'star', color: 'var(--tag-fix)' },
  Feature: { id: 'compass', color: 'var(--tag-feature)' },
  Improvement: { id: 'acorn', color: 'var(--tag-improvement)' },
};

export interface ChapterItem { text: string; tag: Tag }
export interface Chapter {
  date: string;
  hue: string;
  heroIcon: HeroIcon;
  narrative: string;
  items: ChapterItem[];
}

const tagFor = (s: string): Tag =>
  /\bfix(es|ed)?\b/i.test(s) ? 'Fix'
  : /\bimprove|\boptimi[sz]e|\brefactor|\bupdate\b/i.test(s) ? 'Improvement'
  : 'Feature';

export function parseStoryChapters(md: string): Chapter[] {
  const chapters: Array<{ date: string; entries: string[] }> = [];
  let current: { date: string; entries: string[] } | null = null;
  for (const line of md.split('\n')) {
    const dateMatch = line.match(/^##\s+(.+)$/);
    if (dateMatch) { current = { date: dateMatch[1]!.trim(), entries: [] }; chapters.push(current); continue; }
    const summaryMatch = current && line.match(/^-\s*Summary:\s*(.+)$/i);
    if (summaryMatch) current!.entries.push(summaryMatch[1]!.trim());
  }
  return chapters.filter(c => c.entries.length).map((c, i) => ({
    date: c.date,
    hue: STORY_HUES[i % STORY_HUES.length]!,
    heroIcon: STORY_HERO_ICONS[i % STORY_HERO_ICONS.length]!,
    narrative: c.entries[0]!,
    items: c.entries.map(s => ({ text: s.length > 100 ? s.slice(0, 97) + '…' : s, tag: tagFor(s) })),
  }));
}
