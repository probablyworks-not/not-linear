import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStoryChapters, STORY_HUES, STORY_TAG_HUES } from '../../../src/changelog/parse';
import { FALLBACK_CHANGELOG_MD } from '../../../src/changelog/fallback-changelog';

// Runs the REAL legacy parseStoryChapters: its source is cut out of app.js and
// evaluated, so the oracle cannot drift from what ships. Only the colour values
// differ by design (legacy hex/oklch literals vs tokens.css variables), so hues
// are compared by index into each side's own palette.
const root = resolve(__dirname, '../../../..');
const appJs = readFileSync(resolve(root, 'frontend/app.js'), 'utf8');

function sliceBalanced(src: string, from: number): string {
  const open = src.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error('unbalanced');
}
const line = (name: string) => appJs.match(new RegExp(`^\\s*const ${name} = .*;$`, 'm'))![0];

const fnStart = appJs.indexOf('function parseStoryChapters(md)');
const legacyPalette = new Function(`${line('STORY_HUES')}\nreturn STORY_HUES;`)() as string[];
const legacy = new Function(
  `${line('STORY_HUES')}\n${line('STORY_HERO_ICONS')}\n${sliceBalanced(appJs, fnStart)}\nreturn parseStoryChapters;`,
)() as (md: string) => Array<{ date: string; hue: string; heroIcon: string; narrative: string; items: Array<{ text: string; tag: string }> }>;

const normalise = (chs: ReturnType<typeof legacy>, palette: readonly string[]) =>
  chs.map(c => ({ ...c, hue: palette.indexOf(c.hue) }));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function expectSame(md: string, where: string) {
  expect(normalise(parseStoryChapters(md) as never, STORY_HUES), where).toEqual(normalise(legacy(md), legacyPalette));
}

describe('parseStoryChapters: port vs the legacy function', () => {
  it('real CHANGELOG.md', () => {
    expectSame(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'), 'CHANGELOG.md');
    expect(parseStoryChapters(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')).length).toBeGreaterThan(3);
  });

  it('the bundled fallback', () => {
    expectSame(FALLBACK_CHANGELOG_MD, 'fallback');
  });

  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    it(`generated markdown, seed ${seed}`, () => {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      const stems = ['Fixed a crash', 'Added a panel', 'Improved loading', 'Refactor the store', 'Update the docs', 'Optimised search', 'Optimized search', 'Fixes the bug', 'Prefix handling', 'Unfixed thing', 'x'];
      const lines: string[] = ['# Changelog', ''];
      for (let c = 0; c < 1 + Math.floor(r() * 7); c++) {
        lines.push(pick(['## 2026-01-0' + (c + 1), '##   padded  date  ', '## ', '##nodate', '### sub', '## 2026-02-02']));
        for (let e = 0; e < Math.floor(r() * 4); e++) {
          const len = pick([0, 10, 60, 90, 97, 98, 100, 101, 140]);
          lines.push(pick(['- Summary: ', '-Summary:', '- summary: ', '- SUMMARY:   ', '- Agent: x\n- Summary: ']) + pick(stems) + 'y'.repeat(len));
          lines.push(pick(['', '- Files changed: a', '  - Summary: indented', 'Summary: no dash']));
        }
      }
      expectSame(lines.join(pick(['\n', '\n\n'])), `seed ${seed}`);
    });
  }

  it('edge inputs', () => {
    for (const md of ['', '\n', 'no headings', '## only a date', '- Summary: before any heading\n## d\n- Summary: after', '## a\n- Summary: x\n## b\n## c\n- Summary: y']) expectSame(md, JSON.stringify(md));
  });

  it('the oracle can fail: a one-character change in tagging is detected', () => {
    const md = '## d\n- Summary: Fixed it';
    const mutated = normalise(parseStoryChapters(md) as never, STORY_HUES).map(c => ({ ...c, items: c.items.map(i => ({ ...i, tag: 'Feature' })) }));
    expect(mutated).not.toEqual(normalise(legacy(md), legacyPalette));
  });
});

describe('colours: tokens.css carries the legacy literals', () => {
  const tokens = readFileSync(resolve(root, 'frontend/styles/tokens.css'), 'utf8');
  const tokenValue = (name: string) => tokens.match(new RegExp(`--${name}:([^;]+);`))![1]!.trim();

  it('chapter hues', () => {
    legacyPalette.forEach((hex, i) => expect(tokenValue(`story-hue-${i + 1}`).toLowerCase()).toBe(hex.toLowerCase()));
    expect(STORY_HUES).toHaveLength(legacyPalette.length);
  });

  it('tag hues', () => {
    const block = appJs.match(/const STORY_TAG_HUES = \{([\s\S]*?)\n  \};/)![1]!;
    const legacyTags = Object.fromEntries([...block.matchAll(/(\w+):\s*\{\s*id:\s*'(\w+)',\s*hex:\s*'([^']+)'/g)].map(m => [m[1]!, { id: m[2]!, hex: m[3]! }]));
    expect(Object.keys(legacyTags).sort()).toEqual(Object.keys(STORY_TAG_HUES).sort());
    for (const [tag, v] of Object.entries(STORY_TAG_HUES)) {
      expect(v.id).toBe(legacyTags[tag]!.id);
      expect(tokenValue(v.color.replace(/^var\(--|\)$/g, ''))).toBe(legacyTags[tag]!.hex);
    }
  });
});
