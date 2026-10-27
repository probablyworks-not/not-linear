// Isolated rendering spike. No app database, providers, or desktop installation.
// Nonzero exit means the production-integration gate remains CLOSED.
import { chromium } from '../../web/node_modules/@playwright/test/index.mjs';
import { readFileSync } from 'node:fs';
const planner = readFileSync(new URL('./plan-pages.mjs', import.meta.url), 'utf8').replace('export function', 'function');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  async function fixture(name, html, exercise) {
    await page.setContent('<iframe sandbox="allow-scripts" style="width:880px;height:640px;border:0"></iframe>');
    await page.locator('iframe').evaluate((el, source) => { el.srcdoc = source; }, html);
    const frame = page.frames().find(f => f.parentFrame());
    await frame.waitForSelector('[data-ready]');
    const result = await exercise(frame, page);
    results.push({ name, ...result });
  }
  await fixture('Ancestor CSS survives original-node movement', `<!doctype html><style>body{margin:0}#report>p{font-size:24px;line-height:2;padding:12px}#report{display:block}</style><main id="report" data-ready><p>Direct-child styling and delegated behavior must survive pagination.</p><p>Next passage.</p></main><script>window.clicks=0;document.querySelector('#report').onclick=()=>window.clicks++;</script>`, async frame => {
    return frame.evaluate(() => {
      const report = document.querySelector('#report'), node = report.firstElementChild;
      const before = { size: getComputedStyle(node).fontSize, height: node.getBoundingClientRect().height };
      // The prototype's operation: move an original block into a page wrapper.
      const section = document.createElement('section'); report.append(section); section.append(node);
      node.click();
      const after = { size: getComputedStyle(node).fontSize, height: node.getBoundingClientRect().height };
      return { pass: before.size === after.size && before.height === after.height && window.clicks === 1, before, after, delegatedClicks: window.clicks };
    });
  });
  await fixture('Long paragraph fits the section limit', '<!doctype html><style>p{font:20px/1.6 system-ui;margin:0}</style><p data-ready>' + 'One unsplit paragraph must not exceed the section height. '.repeat(350) + '</p>', async frame => {
    await frame.addScriptTag({ content: planner + ';window.planPages=planPages;' });
    return frame.evaluate(() => {
      const height = document.querySelector('p').getBoundingClientRect().height;
      const pages = window.planPages([{ id: 'paragraph', height }]);
      return { pass: pages.every(p => p.height <= 640), measuredHeight: height, sectionHeights: pages.map(p => p.height) };
    });
  });
  await fixture('Long table splits between rows', '<!doctype html><style>td{height:40px}table{border-collapse:collapse}</style><table data-ready><thead><tr><th>Item</th></tr></thead><tbody>' + Array.from({length: 35}, (_, i) => `<tr><td>Row ${i + 1}</td></tr>`).join('') + '</tbody></table>', async frame => {
    await frame.addScriptTag({ content: planner + ';window.planPages=planPages;' });
    return frame.evaluate(() => {
      const table = document.querySelector('table');
      const pages = window.planPages([{ id: 'table', height: table.getBoundingClientRect().height }]);
      return { pass: pages.length > 1 && pages.every(p => p.height <= 640), rows: table.rows.length, sectionHeights: pages.map(p => p.height) };
    });
  });
  await fixture('Viewport height does not follow expanded iframe height', '<!doctype html><style>body{margin:0}.hero{height:100vh}</style><div class="hero" data-ready>Viewport hero</div><p>Following section</p>', async (frame, page) => {
    const measurements = [];
    for (let i = 0; i < 4; i++) {
      const next = await frame.evaluate(() => document.documentElement.scrollHeight);
      measurements.push(next);
      await page.locator('iframe').evaluate((el, height) => { el.style.height = `${height}px`; }, next);
    }
    return { pass: measurements.at(-1) === measurements.at(-2), measurements };
  });
  console.log(JSON.stringify({ productionIntegrationReady: results.every(r => r.pass), results }, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 2;
} finally { await browser.close(); }
