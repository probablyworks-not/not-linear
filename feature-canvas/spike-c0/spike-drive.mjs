// C0 spike driver. Throwaway: drives the harness at :5199 and prints measured results.
import { chromium } from '@playwright/test';

const URL = 'http://127.0.0.1:5199/web/spike.html';
const out = [];
const log = (k, v) => { out.push([k, v]); console.log(`${k.padEnd(46)} ${v}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="node-n0"]');
log('page load -> first node visible (ms)', Date.now() - t0);

const hud = async k => (await page.locator(`[data-testid="${k}"]`).innerText()).trim();
const transform = () => page.locator('.react-flow__viewport').evaluate(el => el.style.transform);
const undoDepth = async () => parseInt((await hud('hud-undo')).split('/')[0].trim(), 10);
const nodeCount = () => page.locator('.react-flow__node').count();

await page.waitForTimeout(700);
log('nodes rendered', await nodeCount());
log('edges rendered', await page.locator('.react-flow__edge').count());
log('HUD first paint (ms since nav)', await hud('hud-paint'));

// ---- 1. text selection must not pan ----
const body = page.locator('[data-testid="node-n7"] .sp-body');
const bb = await body.boundingBox();
const before = await transform();
await page.mouse.move(bb.x + 20, bb.y + 18);
await page.mouse.down();
await page.mouse.move(bb.x + 240, bb.y + 22, { steps: 12 });
await page.mouse.up();
let selText = await page.evaluate(() => window.getSelection().toString());
if (!selText) { await body.dblclick({ position: { x: 30, y: 18 } }); selText = await page.evaluate(() => window.getSelection().toString()); }
const after = await transform();
log('1a selected text length', selText.length);
log('1b viewport unchanged during text drag', before === after ? 'PASS' : `FAIL (${before} -> ${after})`);

// ---- 4. nested scroll consumed by inner panel ----
const inner = page.locator('[data-testid="inner-n7"]');
const ib = await inner.boundingBox();
const vpBefore = await transform();
await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(250);
const innerTop = await inner.evaluate(el => el.scrollTop);
log('4a inner panel scrollTop', innerTop);
log('4b viewport unchanged on nested wheel', vpBefore === (await transform()) ? 'PASS' : 'FAIL');

// wheel on the background SHOULD pan
await page.mouse.move(800, 950);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(250);
log('4c background wheel pans the world', vpBefore !== (await transform()) ? 'PASS' : 'FAIL');

// ---- 2. resize correctness at three zooms ----
for (const z of [0.5, 1, 2]) {
  await page.locator('[data-testid="btn-reset"]').click();
  await page.waitForTimeout(200);
  await page.locator(`.sp-bar button:text-is("${Math.round(z * 100)}%")`).click();
  await page.waitForTimeout(350);
  // bring a node into view and select it
  await page.locator('[data-testid="node-n0"] .sp-head').click();
  await page.waitForTimeout(250);
  const dimsBefore = await hud('hud-dims');
  const u0 = await undoDepth();
  const h = page.locator('.react-flow__node.selected .react-flow__resize-control.handle.bottom.right').first();
  const hbb = await h.boundingBox();
  if (!hbb) { log(`2 resize @${z * 100}%`, 'SKIP (handle offscreen)'); continue; }
  const SCREEN_DX = 100, SCREEN_DY = 60;
  await page.mouse.move(hbb.x + hbb.width / 2, hbb.y + hbb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hbb.x + hbb.width / 2 + SCREEN_DX, hbb.y + hbb.height / 2 + SCREEN_DY, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dimsAfter = await hud('hud-dims');
  const u1 = await undoDepth();
  const [w0, h0] = dimsBefore.split('×').map(Number);
  const [w1, h1] = dimsAfter.split('×').map(Number);
  const expW = Math.round(SCREEN_DX / z), expH = Math.round(SCREEN_DY / z);
  log(`2 resize @${z * 100}%: logical dw/dh`, `${w1 - w0}/${h1 - h0}  expected ~${expW}/${expH}`);
  log(`2 resize @${z * 100}%: undo entries added`, `${u1 - u0} (want exactly 1)`);
  await page.locator('[data-testid="btn-undo"]').click();
  await page.waitForTimeout(250);
  log(`2 resize @${z * 100}%: undo restores`, (await hud('hud-dims')) === dimsBefore ? 'PASS' : `FAIL (${await hud('hud-dims')} != ${dimsBefore})`);
}

// ---- 3. streaming must not re-render the scene ----
await page.locator('.sp-bar button:text-is("100%")').click();
await page.waitForTimeout(300);
const s0 = { scene: await hud('hud-scene'), tail: await hud('hud-tail'), nodes: await hud('hud-nodes') };
await page.locator('[data-testid="btn-stream"]').click();
await page.waitForTimeout(2500);
const s1 = { scene: await hud('hud-scene'), tail: await hud('hud-tail'), nodes: await hud('hud-nodes') };
log('3a streamTail renders during stream', `${s0.tail} -> ${s1.tail}`);
log('3b scene renders during stream', `${s0.scene} -> ${s1.scene} ${s0.scene === s1.scene ? 'PASS (unchanged)' : 'FAIL'}`);
log('3c node renders n0/n7 during stream', `${s0.nodes} -> ${s1.nodes}`);
const tailLen = await page.locator('[data-testid="stream-tail"]').innerText();
log('3d streamed text length', tailLen.length);

// ---- 5. scoped composer in screen space, clamped ----
await page.locator('[data-testid="node-n0"] .sp-head').click();
await page.waitForTimeout(300);
const comp = page.locator('[data-testid="scoped-composer"]');
log('5a composer visible on selection', (await comp.count()) === 1 ? 'PASS' : 'FAIL');
const cb1 = await comp.boundingBox();
const vs = page.viewportSize();
log('5b composer inside viewport', (cb1.x >= 0 && cb1.y >= 0 && cb1.x + cb1.width <= vs.width && cb1.y + cb1.height <= vs.height) ? 'PASS' : `FAIL ${JSON.stringify(cb1)}`);
const cw1 = await comp.evaluate(el => el.getBoundingClientRect().width);
await page.locator('.sp-bar button:text-is("50%")').click();
await page.waitForTimeout(400);
const cw2 = await comp.evaluate(el => el.getBoundingClientRect().width);
log('5c composer width unscaled by zoom', `${cw1} -> ${cw2} ${cw1 === cw2 ? 'PASS' : 'FAIL'}`);
const cb2 = await comp.boundingBox();
log('5d composer still inside viewport at 50%', (cb2.x >= 0 && cb2.y >= 0 && cb2.x + cb2.width <= vs.width && cb2.y + cb2.height <= vs.height) ? 'PASS' : `FAIL ${JSON.stringify(cb2)}`);

// ---- 6. keyboard-only resize, branch, focus ----
await page.locator('.sp-bar button:text-is("100%")').click();
await page.waitForTimeout(300);
await page.locator('[data-testid="node-n0"] .sp-head').click();
await page.waitForTimeout(250);
await page.locator('[data-testid="node-n0"]').focus();
const focusTag = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.className);
log('6a focus lands on the node', focusTag);
const kd0 = await hud('hud-dims'); const ku0 = await undoDepth();
await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(350);
log('6b keyboard resize (1 press)', `${kd0} -> ${await hud('hud-dims')} (want +20 width)`);
log('6c keyboard resize undo entries', `${(await undoDepth()) - ku0} (want exactly 1)`);
const nc0 = await nodeCount();
await page.locator('[data-testid="node-n0"]').focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
log('6d Enter creates a branch node', `${nc0} -> ${await nodeCount()}`);
const outline = await page.locator('[data-testid="node-n0"]').evaluate(el => { el.focus(); return getComputedStyle(el).outlineWidth; });
log('6e focus outline width', outline);

// ---- perf bench ----
await page.locator('[data-testid="btn-bench"]').click();
await page.waitForTimeout(3500);
log('pan frame mean / p95 / worst', await hud('hud-frames'));

// deep-zoom readability check + screenshot
await page.locator('.sp-bar button:text-is("100%")').click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/private/tmp/claude-501/-Users-yash-Downloads-notlinear/20b79ae5-e891-449e-b941-38609c094cc1/scratchpad/spike-100.png' });
await page.locator('.sp-bar button:text-is("50%")').click();
await page.waitForTimeout(400);
await page.screenshot({ path: '/private/tmp/claude-501/-Users-yash-Downloads-notlinear/20b79ae5-e891-449e-b941-38609c094cc1/scratchpad/spike-50.png' });

log('page errors', errors.length === 0 ? 'none' : errors.slice(0, 5).join(' | '));
await browser.close();
