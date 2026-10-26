import { create } from 'zustand';

// Mind Garden: the hand-drawn SVG icon set that is both the default glyph on every thread and
// project row and what the icon picker offers (core/mind-garden.js). The sheet
// `public/mind-garden-icons.html` is the single source, so it is fetched and parsed once and
// shared. An icon a user chose is stored as a token on the thread or
// project: `icon:<id>` or `icon:<id>:<hex>`.

export interface IconEntry { id: string; name: string; section: string; body: string; keywords: string }

const SHEET_URL = `${import.meta.env.BASE_URL}mind-garden-icons.html`;

/** `{ id, color }` for an `icon:` token, or null for anything else (an emoji, or nothing). */
export function parseIconToken(token: unknown): { id: string; color: string } | null {
  if (typeof token !== 'string' || !token.startsWith('icon:')) return null;
  const rest = token.slice(5);
  const colon = rest.indexOf(':');
  const id = colon < 0 ? rest : rest.slice(0, colon);
  if (!id) return null;
  return { id, color: colon < 0 ? '' : '#' + rest.slice(colon + 1) };
}

/* eslint-disable no-restricted-syntax -- reason: these hex values are saved inside `icon:<id>:<hex>` tokens that legacy reads, and an SVG stroke cannot take a CSS variable */
/** The picker's palette: Notion-style names, with '' meaning "inherit the text colour". */
export const ICON_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'default', hex: '' }, { name: 'black', hex: '#1f1f1f' }, { name: 'gray', hex: '#9b9b9b' }, { name: 'brown', hex: '#8b5a2b' },
  { name: 'mustard', hex: '#d4a017' }, { name: 'orange', hex: '#f08c1f' }, { name: 'green', hex: '#2f7a3a' }, { name: 'blue', hex: '#2d6cdf' },
  { name: 'purple', hex: '#7c3aed' }, { name: 'pink', hex: '#c93d72' }, { name: 'red', hex: '#c43a3a' },
];

/**
 * Defaults shown when nothing was chosen, cycling by position (ADR-015). Literal colours on
 * purpose, as in legacy: an SVG `stroke` attribute cannot resolve a CSS variable.
 */
export const PROJECT_ICON_CYCLE = [
  { id: 'iris', color: 'oklch(55% 0.11 290)' }, { id: 'acorn', color: 'oklch(52% 0.10 55)' },
  { id: 'compass', color: 'oklch(48% 0.08 195)' }, { id: 'star', color: 'oklch(55% 0.13 25)' },
] as const;
export const THREAD_ICON_CYCLE = [
  { id: 'branch', color: '#58A6FF' }, { id: 'compass', color: 'oklch(48% 0.08 195)' },
  { id: 'roots', color: 'oklch(50% 0.10 145)' }, { id: 'star', color: 'oklch(55% 0.13 25)' },
] as const;
/** C11. The Canvas library's default cycle — same idea as the other two, a distinct enough set
 * that two neighbouring canvases rarely default to the same glyph. */
export const CANVAS_ICON_CYCLE = [
  { id: 'compass', color: '#58A6FF' }, { id: 'star', color: 'oklch(52% 0.10 55)' },
  { id: 'branch', color: 'oklch(48% 0.08 195)' }, { id: 'roots', color: 'oklch(55% 0.13 25)' },
] as const;
/* eslint-enable no-restricted-syntax */

export const cycleIcon = <T extends { id: string; color: string }>(cycle: readonly T[], index: number): T =>
  cycle[((index % cycle.length) + cycle.length) % cycle.length]!;

function parseSheet(html: string): IconEntry[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: IconEntry[] = [];
  doc.querySelectorAll('section').forEach(sec => {
    const section = sec.querySelector('h2')?.firstChild?.textContent?.trim() || '';
    sec.querySelectorAll('figure').forEach(fig => {
      const fc = fig.querySelector('figcaption');
      if (!fc) return;
      const name = (fc.firstChild?.textContent || '').trim();
      const code = fc.querySelector('code')?.textContent?.trim() || '';
      const g = fig.querySelector('svg > g');
      if (!name || !code || !g) return;
      const id = code.replace(/Icon$/, '').replace(/^./, c => c.toLowerCase());
      out.push({ id, name, section, body: g.innerHTML, keywords: `${name} ${section} ${id}`.toLowerCase() });
    });
  });
  return out;
}

interface MindGardenStore { entries: IconEntry[]; status: 'idle' | 'loading' | 'ready' | 'failed'; load(): Promise<void> }

let pending: Promise<void> | null = null;

export const useMindGarden = create<MindGardenStore>((set, get) => ({
  entries: [],
  status: 'idle',
  load() {
    if (get().status === 'ready') return Promise.resolve();
    // One fetch however many rows ask; a failure clears it so the next ask retries (legacy does the same).
    pending ??= (async () => {
      set({ status: 'loading' });
      try {
        const res = await fetch(SHEET_URL);
        if (!res.ok) throw new Error(`mind-garden sheet ${res.status}`);
        set({ entries: parseSheet(await res.text()), status: 'ready' });
      } catch {
        set({ status: 'failed' });
        pending = null;
      }
    })();
    return pending;
  },
}));

/** Inline SVG for an icon, or '' when it is not in the sheet (the caller shows a fallback). */
export function renderIconSvg(entries: readonly IconEntry[], id: string, { size = 18, color = '' }: { size?: number; color?: string } = {}): string {
  const entry = entries.find(e => e.id === id);
  if (!entry) return '';
  const stroke = color || 'currentColor';
  const styleAttr = color ? ` style="color:${stroke}"` : '';
  return `<svg class="mg-icon" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${styleAttr}><g>${entry.body}</g></svg>`;
}
