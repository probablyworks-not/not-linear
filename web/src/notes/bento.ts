// The Notes home page's bento layout, ported from frontend/views/notes.js (tintFor, seedRand, shapeFor,
// BLOOM_BASE_SIZE, timeAgo). Everything is derived from a page's id and icon, so nothing is stored and a
// card keeps its colour and shape from one visit to the next.

export const BENTO_TINTS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'] as const;

/** Which of the 8 tints a page gets: hashed from its own icon, so the same icon is always the same colour. */
export function tintFor(iconValue: unknown): (typeof BENTO_TINTS)[number] {
  let sum = 0;
  for (const ch of String(iconValue || '')) sum += ch.codePointAt(0)!;
  return BENTO_TINTS[sum % BENTO_TINTS.length]!;
}

/** A small seeded generator (mulberry32 over a string hash). */
export function seedRand(seed: string): () => number {
  let s = 0;
  for (let i = 0; i < seed.length; i++) { s = (s << 5) - s + seed.charCodeAt(i); s |= 0; }
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BentoShape = '' | 'wide' | 'tall' | 'big';

/** The most recently edited page (index 0) is always the big anchor tile; the rest are mostly normal. */
export function shapeFor(id: string, idx: number): BentoShape {
  if (idx === 0) return 'big';
  const r = seedRand(`${id}:shape`)();
  if (r < 0.55) return '';
  if (r < 0.76) return 'wide';
  if (r < 0.92) return 'tall';
  return 'big';
}

export const BLOOM_BASE_SIZE: Record<BentoShape, number> = { '': 100, wide: 130, tall: 130, big: 150 };

/** Size and tilt of the faint icon bleeding off a card's bottom-right corner. */
export function bloomFor(id: string, shape: BentoShape): { size: number; rotate: number } {
  const rand = seedRand(id);
  return { size: BLOOM_BASE_SIZE[shape] + Math.round(rand() * 50), rotate: Math.round(rand() * 20 - 10) };
}

/** "3 minutes ago", falling back to a short date after a few weeks. */
export function timeAgo(ts: number | undefined, now = Date.now()): string {
  if (!ts) return '';
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}${min === 1 ? ' minute ago' : ' minutes ago'}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}${hr === 1 ? ' hour ago' : ' hours ago'}`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}${day === 1 ? ' day ago' : ' days ago'}`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}${wk === 1 ? ' week ago' : ' weeks ago'}`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
