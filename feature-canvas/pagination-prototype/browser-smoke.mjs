// No app server, database, provider calls, or installed desktop app involved.
import { chromium } from '../../web/node_modules/@playwright/test/index.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = read('demo.html').replace('<script type="module" src="./demo.mjs"></script>', '');
const script = read('plan-pages.mjs').replace('export function', 'function') + '\n' + read('demo.mjs').replace(/^import .*;\n/, '');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setContent(html); await page.addScriptTag({ content: script });
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Complete'));
  assert.equal(await page.locator('.page').count(), 1);
  assert.ok((await page.locator('.page').boundingBox()).height < 640);
  await page.locator('[data-fixture="long"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.page').length > 1);
  assert.equal(await page.locator('[data-source-block]').count(), 26);
  assert.equal(await page.locator('#measure > *').count(), 0);
  const ids = await page.locator('[data-source-block]').evaluateAll(nodes => nodes.map(n => n.dataset.sourceBlock));
  assert.deepEqual(ids, Array.from({length: 26}, (_, i) => String(i)));
  // Real mouse input across a page gap, not only a synthetic DOM range.
  await page.setViewportSize({ width: 1200, height: 1600 });
  const from = await page.locator('.page').nth(0).locator('.block').last().boundingBox();
  const to = await page.locator('.page').nth(1).locator('.block').first().boundingBox();
  await page.mouse.move(from.x + 8, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x + Math.min(to.width - 8, 180), to.y + 12, { steps: 24 });
  await page.mouse.up();
  assert.ok(await page.evaluate(() => {
    const selection = window.getSelection();
    const start = selection.anchorNode?.parentElement?.closest('.page');
    const end = selection.focusNode?.parentElement?.closest('.page');
    return selection.toString().length > 0 && start && end && start !== end;
  }), 'Mouse selection must cross the section gap in the same document');
  await page.evaluate(() => window.getSelection().removeAllRanges());
  // DOM range continuity is a separate check from real mouse dragging (still required).
  const selected = await page.evaluate(() => {
    const sections = document.querySelectorAll('.page');
    const range = document.createRange(); range.setStartBefore(sections[0].lastElementChild); range.setEndAfter(sections[1].firstElementChild);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return selection.toString();
  });
  assert.ok(selected.length > 0);
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.locator('[data-fixture="chart"]').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('initialized 1 time'));
  const chart = await page.locator('canvas').elementHandle();
  await page.setViewportSize({ width: 800, height: 800 });
  await page.waitForFunction(() => document.querySelector('#pages').clientWidth === 768);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await chart.evaluate(el => el === document.querySelector('canvas')), true);
  assert.ok((await page.locator('#status').textContent()).includes('initialized 1 time'));
  const beforeChart = await chart.evaluate(el => el.toDataURL());
  await page.locator('canvas').click();
  assert.notEqual(await chart.evaluate(el => el.toDataURL()), beforeChart, 'Moved chart must still respond to clicks');
  await page.locator('[data-fixture="stream"]').click(); await page.waitForSelector('[aria-busy="true"]');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.pending').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
  await page.locator('#stop').click(); await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  assert.deepEqual(errors, []);
  console.log('PASS: short/long sections, block identity, real mouse selection across sections, DOM range, retained interactive chart, shimmer/stop/reduced motion.');
} finally { await browser.close(); }
