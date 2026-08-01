// Mind Garden — 145 hand-drawn SVG icons loaded from the design sheet at
// `frontend/mind-garden-icons.html`. The sheet is the source of truth so the
// app and the print-ready design doc never drift. We fetch+parse it once,
// lazily on first picker open, and cache the parsed entries.

let loadPromise = null;
let entries = [];   // { id, name, section, body, keywords }

async function loadSheet(){
  const url = new URL('../mind-garden-icons.html', import.meta.url).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mind-garden sheet ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
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
      out.push({
        id,
        name,
        section,
        body: g.innerHTML,
        keywords: `${name} ${section} ${id}`.toLowerCase(),
      });
    });
  });
  entries = out;
  return entries;
}

export function loadMindGarden(){
  if (!loadPromise) loadPromise = loadSheet().catch(err => { loadPromise = null; throw err; });
  return loadPromise;
}

// Inline SVG markup for a chosen icon id. Defaults to `currentColor` (inherits
// theme text color); pass `color` (e.g. "#7C3AED") to lock the stroke to a
// specific color. Returns '' for unknown ids — caller decides the fallback.
export function renderIconSvg(id, { size = 18, color = '' } = {}){
  const entry = entries.find(e => e.id === id);
  if (!entry) return '';
  const stroke = color || 'currentColor';
  // When a custom color is set we also paint the few `fill="currentColor"`
  // accents inside icon bodies (pupils, dots) by overriding via a style block.
  const styleAttr = color ? ` style="color:${stroke}"` : '';
  return `<svg class="mg-icon" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${styleAttr}><g>${entry.body}</g></svg>`;
}

// Parse a stored glyph token of the form `icon:<id>` or `icon:<id>:<hex>`
// (hex is the color without the `#`). Returns `{ id, color }` or null when the
// value isn't an icon token.
export function parseIconToken(token){
  if (typeof token !== 'string' || !token.startsWith('icon:')) return null;
  const rest = token.slice(5);
  const colonIdx = rest.indexOf(':');
  if (colonIdx < 0) return { id: rest, color: '' };
  return { id: rest.slice(0, colonIdx), color: '#' + rest.slice(colonIdx + 1) };
}

// 10 named colors matching the Notion-style palette plus a sentinel for
// "default" (no color = inherit theme text color). Exported so the picker and
// any future surface (e.g. note headers) share one source.
export const ICON_COLORS = [
  { name: 'default', hex: '' },
  { name: 'black',   hex: '#1f1f1f' },
  { name: 'gray',    hex: '#9b9b9b' },
  { name: 'brown',   hex: '#8b5a2b' },
  { name: 'mustard', hex: '#d4a017' },
  { name: 'orange',  hex: '#f08c1f' },
  { name: 'green',   hex: '#2f7a3a' },
  { name: 'blue',    hex: '#2d6cdf' },
  { name: 'purple',  hex: '#7c3aed' },
  { name: 'pink',    hex: '#c93d72' },
  { name: 'red',     hex: '#c43a3a' },
];

export function getMindGardenEntries(){ return entries; }
