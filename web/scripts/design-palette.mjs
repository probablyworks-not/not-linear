/*
 * Renders docs/design-assets/00-palette.png straight from src/styles/tokens.css, so the
 * palette in docs/DESIGN.md is the palette the app actually ships — never a hand-kept copy.
 *
 *     node scripts/design-palette.mjs        (or: pnpm shots, which runs this too)
 *
 * Adding a token to tokens.css does NOT add it here: list it in GROUPS below, in the group
 * where a designer would look for it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = new URL('../../docs/design-assets/00-palette.png', import.meta.url).pathname;
const TMP = new URL('../node_modules/.cache/design-palette.html', import.meta.url).pathname;
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

const GROUPS = [
  ['Surfaces', ['bg', 'bg-2', 'bg-3', 'surface', 'surface-2', 'user-bub']],
  ['Rules', ['rule', 'rule-2']],
  ['Text', ['text', 'text-2', 'text-3']],
  ['Accent & links', ['accent', 'accent-2', 'accent-soft', 'link', 'link-hover']],
  ['Interaction hues', ['branch', 'branch-soft', 'branch-strong', 'highlight', 'highlight-soft', 'highlight-strong']],
  ['Status', ['danger', 'danger-soft', 'danger-strong', 'success', 'annotate', 'scrim']],
  ['Project sections', ['sec-notes', 'sec-notes-soft', 'sec-notes-line', 'sec-artifacts', 'sec-artifacts-soft', 'sec-artifacts-line', 'sec-files', 'sec-files-soft', 'sec-files-line']],
  ['Code syntax', ['syn-keyword', 'syn-string', 'syn-number', 'syn-comment', 'syn-function', 'syn-tag', 'syn-attr']],
];
const THEMES = [['dark', 'Dark (default)'], ['grey', 'Grey'], ['light', 'Light']];

const swatch = t => `<div class="sw"><span class="chip" style="background:var(--${t})"></span><code>--${t}</code></div>`;
const group = ([name, toks]) => `<div class="grp"><h3>${name}</h3><div class="row">${toks.map(swatch).join('')}</div></div>`;
// Each panel is scoped with data-preview-theme, which tokens.css defines alongside
// html[data-theme] — so all three themes render on one page, from one stylesheet.
const panel = ([theme, label]) => `
<section data-preview-theme="${theme}" class="panel">
  <header><h2>${label}</h2><code>html[data-theme="${theme}"]</code></header>
  ${GROUPS.map(group).join('')}
</section>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=Space+Mono&display=swap" rel="stylesheet">
<style>${css}
*{box-sizing:border-box}
body{margin:0;font-family:var(--font);display:grid;grid-template-columns:repeat(3,1fr)}
.panel{background:var(--bg);color:var(--text);padding:22px 20px 26px;min-height:100%}
.panel header{display:flex;align-items:baseline;gap:10px;padding-bottom:12px;margin-bottom:16px;border-bottom:1px solid var(--rule-2)}
h2{font-size:14px;font-weight:600;margin:0;letter-spacing:-0.01em}
header code{font-family:var(--mono);font-size:10px;color:var(--text-3)}
.grp{margin-bottom:18px}
h3{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3);margin:0 0 8px;font-weight:400}
.row{display:flex;flex-direction:column;gap:5px}
.sw{display:flex;align-items:center;gap:9px}
.chip{width:30px;height:18px;border-radius:4px;border:1px solid var(--rule-2);flex:none}
code{font-family:var(--mono);font-size:11px;color:var(--text-2)}
</style></head><body>${THEMES.map(panel).join('')}</body></html>`;

mkdirSync(new URL('.', `file://${TMP}`).pathname, { recursive: true });
writeFileSync(TMP, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(`file://${TMP}`);
await page.waitForTimeout(1500); // the webfont, so the labels are not shot in a fallback face
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(`palette → ${OUT}`);
