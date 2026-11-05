import { test, expect, type Page, type Route } from '@playwright/test';
import { addMessage, branchFrom, createRootThread, freezeSelection, setGeometry, textPart } from '../../src/canvas/domain/commands';
import { emptyDoc } from '../../src/canvas/types';

// Canvas (C2-C4), end to end in a real browser. The model is mocked — no request leaves the page —
// but everything else is real: the Dexie db, the tabs, React Flow, the composer's persisted drafts.
//
// What this covers that no unit test can: that `canvas:<id>` really survives a reload with two
// canvases open (the Notes singleton-tab regression, bugs #042/#043), that text inside a card is
// actually selectable (React Flow sets user-select:none on nodes — the C0 spike's first defect),
// and that the whole loop holds together.

type Req = { messages: { role: string; content: string }[]; system: string; tools?: { name: string }[] };

async function seed(page: Page, response = 'A widget has a sprocket and a flange.', folderPath = ''): Promise<Req[]> {
  const requests: Req[] = [];
  await page.addInitScript(({ folderPath }) => {
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-test' }));
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.get('state').onsuccess = e => {
        if ((e.target as IDBRequest).result) return;
        store.put({ key: 'state', value: {
          threads: { 'doc-main': { kind: 'doc', title: 'Main', stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {} } },
          current: 'doc-main', dynamic: [], deletedThreads: [], chatCount: 1,
          projects: { p1: { id: 'p1', name: 'Research', rules: '', files: [], path: folderPath, updatedAt: Date.now() } },
          projectCount: 1, prefs: { model: 'opus' },
        } });
      };
      tx.oncomplete = () => db.close();
    };
  }, { folderPath });
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Req;
    requests.push(body);
    const text = response;
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ` ${w}` : w } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
  return requests;
}

async function openProject(page: Page): Promise<void> {
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
  await expect(page.getByTestId('project-overview')).toBeVisible();
}

const canvasTab = (page: Page) => page.getByRole('tab').filter({ hasText: 'Untitled canvas' });

type Artifact = { id: string; title: string; version: number; source: string; canvasId?: string; canvasOutputVersionId?: string };
/** Reads the artifacts db directly: the toast lasts 1800ms, the record is the actual claim. */
async function artifacts(page: Page): Promise<Artifact[]> {
  return page.evaluate(() => new Promise<Artifact[]>(resolve => {
    const open = indexedDB.open('notlinear-artifacts');
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); resolve([]); return; }
      const get = db.transaction('kv', 'readonly').objectStore('kv').get('artifacts_v1');
      get.onsuccess = () => { db.close(); resolve((get.result?.value as Artifact[]) ?? []); };
      get.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

async function newCanvas(page: Page): Promise<void> {
  // The empty card offers New in its body; once there are canvases it is the header's +.
  const existing = page.getByTestId('canvas-workspace');
  const previous = await existing.count() ? await existing.getAttribute('data-canvas') : null;
  const card = page.getByTestId('card-canvases');
  const empty = card.getByTestId('canvas-new-empty');
  if (await empty.count()) await empty.click();
  else await card.getByTestId('canvas-new-card').click();
  await expect(page.getByTestId('project-overview')).not.toBeVisible();
  await expect(page.getByTestId('canvas-workspace')).toBeVisible();
  if (previous) await expect(page.getByTestId('canvas-workspace')).not.toHaveAttribute('data-canvas', previous);
}

// The default "new question" composer starts as a collapsed launcher pill; clicking it expands
// into the full bar. A composer scoped to a selection or a reply thread never collapses, and one
// restoring a non-empty draft expands itself once the draft loads — in both cases the launcher is
// simply not there, which is fine, not a failure.
async function openComposer(page: Page): Promise<void> {
  const launcher = page.getByTestId('ink-launcher');
  const composer = page.getByTestId('ink-composer');
  // The canvas doc store can briefly still reflect the *previous* canvas while a freshly switched-
  // to canvas's own doc loads — long enough to remount InkComposer and silently revert an
  // already-opened launcher back to collapsed a few hundred ms after the click. Retry the
  // click-then-verify rather than race that settle with a single attempt.
  await expect(async () => {
    await expect(launcher.or(composer)).toBeVisible();
    if (await launcher.isVisible()) await launcher.click({ timeout: 500 }).catch(() => undefined);
    await expect(composer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
}

async function ask(page: Page, text: string): Promise<void> {
  await openComposer(page);
  const composer = page.getByTestId('ink-composer');
  await composer.getByRole('textbox').fill(text);
  await composer.getByRole('button', { name: 'Send' }).click();
}

// One IndexedDB origin is shared by the whole run (playwright.config.ts: `workers: 1`), so a spec
// that seeds the chat db has to put it back. Without this, the canvases and the project seeded
// here leak into whatever spec runs next — which is how this spec broke an MCP integrations test
// (#060) and then, less obviously, a different spec on each run.
//
// Order matters. Deleting while the app is still mounted is worse than not cleaning at all: the
// delete blocks on the open connection, and the app immediately re-creates the chat db
// half-seeded. So navigate to a same-origin page that does NOT boot the app, and delete from
// there, with no timeout race to make it nondeterministic.
test.afterEach(async ({ page }) => {
  await page.goto('/tools/export-data.html').catch(() => undefined);
  await page.evaluate(async () => {
    const drop = (name: string) => new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    try { localStorage.clear(); } catch { /* storage may be unavailable */ }
    await drop('notlinear');
    await drop('notlinear-canvas');
    await drop('notlinear-artifacts');
  }).catch(() => undefined);
});

test.describe('the canvas loop', () => {
  test('Canvas hierarchy stays closed until explicitly opened, including after reload', async ({ page }) => {
    await seed(page);
    await openProject(page); await newCanvas(page);
    const toggle = page.getByTestId('canvas-hierarchy-toggle');
    const hierarchy = page.getByTestId('canvas-hierarchy');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(hierarchy).toHaveCount(0);
    await toggle.click();
    await expect(hierarchy).toBeVisible();
    await hierarchy.getByRole('button', { name: 'Hide hierarchy' }).click();
    await expect(hierarchy).toHaveCount(0);
    await toggle.click();
    await expect(hierarchy).toBeVisible();
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(hierarchy).toHaveCount(0);
    await toggle.click();
    await expect(hierarchy).toBeVisible();
  });

  test('Canvas hierarchy locates nested saved branches without changing their geometry', async ({ page }) => {
    await seed(page);
    await openProject(page); await newCanvas(page);
    const id = (await page.getByTestId('canvas-workspace').getAttribute('data-canvas'))!;
    const fixture = emptyDoc({ id, title: 'Hierarchy fixture', projectId: 'p1', rev: 2, createdAt: 1, updatedAt: 1, counts: { threads: 0, messages: 0, outputs: 0 } });
    const root = createRootThread(fixture, 'Main question', { now: 1 });
    const source = freezeSelection(fixture, root.message.id, root.message.parts[0]!.id, 'Main', 0, { now: 2 })!;
    source.highlightTone = 'pink';
    const branch = branchFrom(fixture, { snapshotId: source.id, prompt: 'First branch', title: 'First branch' }, { now: 3 })!;
    const childSource = freezeSelection(fixture, branch.message.id, branch.message.parts[0]!.id, 'First', 0, { now: 4 })!;
    const child = branchFrom(fixture, { snapshotId: childSource.id, prompt: 'Nested question', title: 'Nested question' }, { now: 5 })!;
    createRootThread(fixture, 'Independent question', { now: 6 });
    fixture.threads.forEach((thread, index) => setGeometry(fixture, thread.id, { x: index * 800, y: index * 300, w: 360, h: index === 0 ? 12000 : 300 }));
    fixture.summary.counts = { threads: 4, messages: fixture.messages.length, outputs: 0 };
    await page.evaluate(async fixture => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('notlinear-canvas'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ key: `canvas_doc_v1:${fixture.summary.id}`, value: fixture });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); db.close();
    }, fixture);
    await page.reload();
    await expect(page.getByTestId('canvas-hierarchy-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('canvas-hierarchy-toggle').click();
    const hierarchy = page.getByRole('complementary', { name: 'Canvas hierarchy', exact: true });
    await expect(hierarchy.locator('[data-hierarchy-thread]')).toHaveCount(4);
    const branchRow = hierarchy.locator(`[data-hierarchy-thread="${branch.thread.id}"]`).locator('div').first();
    await expect(branchRow.getByTestId('hierarchy-source')).toHaveText('Main');
    await expect(branchRow.getByTestId('hierarchy-source')).toHaveAttribute('data-highlight-tone', 'pink');
    await expect(branchRow.getByTestId('hierarchy-source')).toHaveClass(/bg-cv-hl-pink/);
    await expect(branchRow.getByTestId('hierarchy-question')).toHaveText('First branch');
    expect(await hierarchy.evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(440);
    expect(await hierarchy.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await hierarchy.locator(`[data-hierarchy-thread="${root.thread.id}"]`).getByRole('button', { name: /^Locate / }).first().click();
    const rootHeader = page.getByTestId(`thread-node-${root.thread.id}`).locator('header').first();
    await page.waitForTimeout(350); // Let the 200ms camera transition finish before checking visibility.
    await expect(rootHeader).toBeInViewport();
    const rootRow = hierarchy.locator(`[data-hierarchy-thread="${root.thread.id}"]`);
    await expect(rootRow.locator(`[data-hierarchy-thread="${child.thread.id}"]`)).toBeVisible();
    await hierarchy.getByRole('button', { name: 'Toggle branches of First branch' }).click();
    await expect(hierarchy.getByRole('button', { name: 'Locate Nested question', exact: true })).toHaveCount(0);
    await hierarchy.getByRole('button', { name: 'Toggle branches of First branch' }).click();
    await hierarchy.getByRole('button', { name: 'Locate Nested question', exact: true }).click();
    await expect(hierarchy.getByRole('button', { name: 'Locate Nested question', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const card = page.locator(`.react-flow__node[data-id="${child.thread.id}"]`);
    await expect.poll(async () => {
      const rect = await card.boundingBox(); const flow = await page.locator('.react-flow').boundingBox();
      return !!rect && !!flow && rect.x >= flow.x && rect.x + rect.width <= flow.x + flow.width + 2;
    }).toBe(true);
    await hierarchy.getByRole('button', { name: 'Read Nested question', exact: true }).click();
    await expect(page.getByTestId('reading-branch')).toContainText('Nested question');
    await page.getByTestId('canvas-reading-toggle').click();
    await hierarchy.getByRole('button', { name: 'Hide hierarchy' }).click();
    await expect(hierarchy).toHaveCount(0);
    await page.getByTestId('canvas-hierarchy-toggle').click();
    await expect(hierarchy).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('canvas-hierarchy-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('canvas-hierarchy-toggle').click();
    await expect(hierarchy.getByRole('button', { name: 'Locate Nested question', exact: true })).toBeVisible();
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    const entries = await page.evaluate(async id => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('notlinear-canvas'); r.onsuccess = () => resolve(r.result); });
      return new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get(`canvas_doc_v1:${id}`); r.onsuccess = () => { resolve(r.result.value.layouts); db.close(); }; });
    }, id);
    expect(entries).toEqual(fixture.layouts);
    await page.screenshot({ path: '/tmp/notlinear-hierarchy-desktop.png', animations: 'disabled' });
  });


  test('formatted selection freezes readable context and restores multi-node marks', async ({ page }) => {
    await seed(page, 'alpha **beta** gamma\n\n' + Array.from({length: 80}, (_, i) => `Paragraph ${i}`).join('\n\n'));
    await openProject(page); await newCanvas(page); await ask(page, 'explain');
    const paragraph = page.locator('.react-flow [data-part] p').filter({ hasText: 'alpha beta gamma' });
    await expect(paragraph).toBeVisible();
    const points = await paragraph.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('button')) texts.push(walker.currentNode as Text);
      const start = document.createRange(); start.setStart(texts[0]!, 0); start.setEnd(texts[0]!, 1);
      const last = texts.at(-1)!;
      const end = document.createRange(); end.setStart(last, last.length - 1); end.setEnd(last, last.length);
      const a = start.getBoundingClientRect(), b = end.getBoundingClientRect();
      return { x1: a.left + 0.5, y1: a.top + a.height / 2, x2: b.right - 0.5, y2: b.top + b.height / 2 };
    });
    await page.mouse.move(points.x1, points.y1); await page.mouse.down();
    await page.mouse.move(points.x2, points.y2, { steps: 12 }); await page.mouse.up();
    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('context-chips')).toContainText('alpha beta gamma');
    await ask(page, 'why?');
    await expect(page.locator('.react-flow mark[data-snapshot-id]')).toHaveCount(3);
    await page.reload();
    await expect(page.locator('.react-flow mark[data-snapshot-id]')).toHaveCount(3);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
  });

  test('improved reading previews HTML but an ordinary child question requests text', async ({ page }) => {
    const requests = await seed(page, '<!doctype html><html><body><p>A widget has a sprocket.</p></body></html>');
    await openProject(page); await newCanvas(page); await ask(page, 'Explain widgets with improved reading');
    const paragraph = page.frameLocator('.react-flow iframe').locator('p').first();
    await expect(paragraph).toHaveText('A widget has a sprocket.');
    expect(requests[0]!.system).toContain('Reply with ONLY the complete, self-contained HTML document');
    await paragraph.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByTestId('add-source').click();
    await page.route('https://api.anthropic.com/v1/messages', async route => {
      requests.push(route.request().postDataJSON() as Req);
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 7 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The sprocket transfers motion.' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
      ];
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
    });
    await ask(page, 'How does this works?');
    await expect(page.locator('.react-flow [data-part]')).toContainText(['The sprocket transfers motion.']);
    expect(requests[1]!.messages.some(m => m.content.includes('improved reading'))).toBe(true);
    expect(requests[1]!.system).toContain('answer in ordinary text with Markdown formatting');
    expect(requests[1]!.system).not.toContain('Reply with ONLY the complete, self-contained HTML document');
    await expect(page.locator('.react-flow iframe')).toHaveCount(1);
  });

  test('token-limited HTML continues to the final table row and survives reload', async ({ page }) => {
    await seed(page);
    let calls = 0;
    await page.route('https://api.anthropic.com/v1/messages', async route => {
      calls++;
      const text = calls === 1
        ? '<!doctype html><html><body><table><tr><td>Upstream</td></tr><tr><td>Oil'
        : ' marketing companies</td><td>Complete final row</td></tr></table></body></html>';
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 7 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'message_delta', delta: { stop_reason: calls === 1 ? 'max_tokens' : 'end_turn' }, usage: { output_tokens: 9 } },
      ];
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
    });
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const cells = () => page.frameLocator('.react-flow iframe').locator('td');
    await expect(cells()).toHaveText(['Upstream', 'Oil marketing companies', 'Complete final row']);
    expect(calls).toBe(2);
    await page.reload();
    await expect(cells()).toHaveText(['Upstream', 'Oil marketing companies', 'Complete final row']);
  });

  test('HTML generation shows completed sections and a reduced-motion shimmer then settles', async ({ page }, testInfo) => {
    await seed(page);
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('api.anthropic.com')) return original(input, init);
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({ start(controller) {
          const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          send({ type: 'message_start', message: { usage: { input_tokens: 1 } } });
          send({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });
          (window as unknown as { beginHtml: () => void }).beginHtml = () => send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '<!doctype html><html><body><p>First completed passage</p>' } });
          (window as unknown as { finishHtml: () => void }).finishHtml = () => {
            send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '<p>Final passage</p></body></html>' } });
            send({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } });
            controller.close();
          };
        } }), { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const live = page.getByTestId('live-html');
    await expect(live).toBeVisible();
    await expect(live.locator('[aria-busy="true"]')).toBeVisible();
    await expect(live.locator('iframe')).toBeHidden();
    await expect(live.locator('.nl-html-skeleton i')).toHaveCount(4);
    expect(await live.locator('.nl-html-pending').evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('nl-html-sweep');
    const sweep = await live.locator('.nl-html-pending').evaluate(el => getComputedStyle(el, '::before').transform);
    await expect.poll(() => live.locator('.nl-html-pending').evaluate(el => getComputedStyle(el, '::before').transform)).not.toBe(sweep);
    await page.screenshot({ path: testInfo.outputPath('html-loading.png') });
    await page.getByTestId('canvas-reading-toggle').click();
    await expect(page.getByTestId('canvas-reading').getByTestId('live-html')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the canvas' }).click();
    await expect(live).toBeVisible();
    await page.evaluate(() => (window as unknown as { beginHtml: () => void }).beginHtml());
    await expect(page.frameLocator('[data-testid="live-html"] iframe').locator('p')).toHaveText('First completed passage');
    await expect(live.locator('iframe')).toBeVisible();
    await expect(live.locator('[aria-busy="true"]')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await live.locator('.nl-html-pending').evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none');
    await page.evaluate(() => (window as unknown as { finishHtml: () => void }).finishHtml());
    await expect(live).toHaveCount(0);
    await expect(page.frameLocator('.react-flow iframe').locator('p').last()).toHaveText('Final passage');
    await expect(page.locator('.nl-html-pending')).toHaveCount(0);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    expect(await page.locator('.react-flow iframe').evaluate(el => (el as HTMLIFrameElement).offsetHeight)).toBeLessThan(640);
  });

  test('a formatted selection deep in a continuous HTML report survives branching and reload', async ({ page }) => {
    const html = '<style>#report>p{font:24px/2 system-ui}</style><main id="report"><p>' + 'Repeated <b>formatted</b> passage &amp; source. '.repeat(180) + '</p></main>';
    await seed(page, html); await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const frame = page.frameLocator('.react-flow iframe');
    await expect(frame.locator('[data-nl-page-gap]')).toHaveCount(0);
    await expect.poll(() => page.locator('.react-flow__node').first().evaluate(el => (el as HTMLElement).offsetWidth)).toBe(880);
    const quote = await frame.locator('p').evaluate(el => {
      const formatted = el.querySelectorAll('b')[40]!;
      const before = formatted.previousSibling as Text, after = formatted.nextSibling as Text;
      const range = document.createRange();
      range.setStart(before, Math.max(0, before.length - 8)); range.setEnd(after, Math.min(after.length, 12));
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return range.cloneContents().textContent!;
    });
    await expect(page.getByTestId('add-source')).toBeVisible();
    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('context-chips')).toContainText(quote.trim());
    await ask(page, 'explain that passage');
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await page.reload();
    await expect.poll(() => page.frameLocator('.react-flow iframe').first().locator('body').evaluate(() => CSS.highlights.size)).toBe(1);
    expect(await page.frameLocator('.react-flow iframe').first().locator('body').evaluate(() => [...CSS.highlights.get('nl-source-0')!].map(range => range.toString()).join('').trim())).toBe(quote.trim());
    await expect(page.getByTestId('canvas-output-detail')).toHaveCount(0);
  });

  test('HTML sections settle and wheel gestures pan the canvas', async ({ page }) => {
    const html = '<!doctype html><html><body style="margin:8px;min-height:100vh"><p>alpha <b>beta</b> &amp; gamma</p>' + '<p>Long HTML document</p>'.repeat(100) + '</body></html>';
    await seed(page, html);
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const iframe = page.locator('.react-flow iframe');
    await expect(iframe).toBeVisible();
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    const frame = page.frameLocator('.react-flow iframe');
    await expect(frame.locator('p').first()).toHaveText('alpha beta & gamma');
    expect(await iframe.evaluate(el => (el as HTMLElement).offsetHeight)).toBeGreaterThan(640);
    expect(await page.getByTestId('html-section').count()).toBe(1);
    await expect.poll(() => iframe.locator('xpath=ancestor::*[contains(@class, "react-flow__node")][1]').evaluate(el => (el as HTMLElement).offsetWidth)).toBe(880);
    await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
    const local = await frame.locator('p').first().evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      const r = range.getBoundingClientRect(); return { left: r.left, width: r.width };
    });
    await expect(page.getByTestId('canvas-selection-popover')).toBeVisible();
    const bounds = (await iframe.boundingBox())!;
    const dimensions = await iframe.evaluate(el => ({ width: (el as HTMLElement).offsetWidth, border: el.clientLeft }));
    const popover = (await page.getByTestId('canvas-selection-popover').boundingBox())!;
    expect(popover.x + popover.width / 2).toBeCloseTo(bounds.x + (local.left + dimensions.border + local.width / 2) * bounds.width / dimensions.width, 0);
    await frame.locator('body').evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await iframe.hover();
    const before = await page.locator('.react-flow__viewport').getAttribute('style');
    await page.mouse.wheel(0, 240);
    await expect.poll(() => page.locator('.react-flow__viewport').getAttribute('style')).not.toBe(before);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    expect(await iframe.evaluate(el => (el as HTMLElement).offsetHeight)).toBeGreaterThan(640);
    expect(await page.getByTestId('html-section').count()).toBe(1);
    await page.reload();
    await expect(page.locator('.react-flow iframe')).toBeVisible();
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
  });

  test('continuous HTML stays inside the canvas through selection, branching and reload', async ({ page }) => {
    const html = '<!doctype html><html><head><title>alpha beta &amp; gamma</title></head><body><p>alpha <b>beta</b> &amp; gamma</p>' + '<p>Reading content</p>'.repeat(60) + '</body></html>';
    await seed(page, html);
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    await expect(page.locator('.react-flow iframe')).toBeVisible();
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    let previousViewport: string | null = null;
    await expect.poll(async () => {
      const next = await page.locator('.react-flow__viewport').getAttribute('style');
      const settled = next === previousViewport; previousViewport = next; return settled;
    }).toBe(true);
    const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
    await expect(page.getByTestId('view-output')).toHaveCount(0);
    const reader = page.getByTestId('canvas-output-detail');
    await expect(reader).toHaveCount(0);
    const iframe = page.locator('.react-flow iframe');
    const frame = page.frameLocator('.react-flow iframe');
    const paragraph = frame.locator('p').first();
    await expect(paragraph).toHaveText('alpha beta & gamma');
    expect(await iframe.evaluate(el => (el as HTMLElement).offsetHeight)).toBeGreaterThan(640);
    expect(await page.getByTestId('html-section').count()).toBe(1);
    await page.screenshot({ path: test.info().outputPath('canvas-full-page-reader.png') });
    await paragraph.evaluate(el => {
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await expect(page.getByTestId('add-source')).toBeVisible();
    await page.getByTestId('add-source').click();
    await expect(reader).toHaveCount(0);
    await expect(page.getByTestId('context-chips')).toContainText('alpha beta & gamma');
    await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', viewport!);
    await ask(page, 'why?');
    await page.reload();
    await expect.poll(() => page.frameLocator('.react-flow iframe').first().locator('body').evaluate(() => CSS.highlights.get('nl-source-0')?.size ?? 0)).toBe(3);
    await expect(page.getByTestId('html-section').first()).toBeVisible();
    await expect(page.getByTestId('canvas-output-detail')).toHaveCount(0);
    const restored = page.frameLocator('.react-flow iframe').first();
    expect(await restored.locator('body').evaluate(() => [...CSS.highlights.get('nl-source-0')!].map(range => range.toString()).join(''))).toBe('alpha beta & gamma');
    expect(await restored.locator('p').first().evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await expect.poll(() => restored.locator('[data-nl-highlights]').textContent()).toContain('35%');
  });

  test('continuous HTML also fills Read mode instead of a short preview', async ({ page }) => {
    const html = '<body><nav style="position:sticky;top:0">Pipeline</nav><section><h2>Full HTML report</h2>' + '<p>Continuous reading passage</p>'.repeat(70) + '<p>Final report passage</p></section></body>';
    await seed(page, html); await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    await expect(page.locator('.react-flow iframe')).toBeVisible();
    await page.getByTestId('canvas-reading-toggle').click();
    const iframe = page.getByTestId('canvas-reading').locator('iframe');
    const frame = page.frameLocator('[data-testid="canvas-reading"] iframe');
    await expect.poll(() => iframe.evaluate(el => (el as HTMLIFrameElement).clientHeight)).toBeGreaterThan(1000);
    await frame.getByRole('heading', { name:'Full HTML report' }).click();
    await expect(frame.getByRole('navigation', { name:'Selected element hierarchy' })).toBeVisible();
    expect(await frame.getByText('Final report passage').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
    await expect(page.getByText('This layout uses a scrollable section to preserve its formatting and interactions.')).toHaveCount(0);
    await page.getByRole('button', { name:'Back to the canvas' }).click();
    await expect.poll(() => page.locator('.react-flow iframe').evaluate(el => (el as HTMLIFrameElement).clientHeight)).toBeGreaterThan(1000);
  });

  test('authored HTML preserves chart colors and readable selections after reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const html = '<style>body{background:white;color:#172033}b{color:#7c3aed!important}p{font:24px/2 system-ui}.chart-bar{height:20px;background:#2563eb!important}</style><div class="chart-bar" style="width:30px"></div><div class="chart-bar" style="width:80px"></div><div class="chart-bar" style="width:160px"></div><p id="contrast">Readable <b>formatted</b> &amp; repeated text.</p>' + '<p>Continuation passage</p>'.repeat(65);
    const requests = await seed(page, html);
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    for (let i = 0; i < 2; i++) {
      const frame = page.frameLocator('.react-flow iframe').first();
      await expect(frame.locator('#contrast')).toHaveText('Readable formatted & repeated text.');
      expect(await frame.locator('#contrast b').evaluate(el => {
        const style = getComputedStyle(el), selected = getComputedStyle(el, '::selection');
        return [style.color, style.webkitTextFillColor, style.backgroundColor, selected.color];
      })).toEqual(['rgb(124, 58, 237)', 'rgb(124, 58, 237)', 'rgba(0, 0, 0, 0)', 'rgb(0, 0, 0)']);
      expect(await frame.locator('.chart-bar').evaluateAll(els => els.map(el => [getComputedStyle(el).backgroundColor, el.getBoundingClientRect().width]))).toEqual([['rgb(37, 99, 235)', 30], ['rgb(37, 99, 235)', 80], ['rgb(37, 99, 235)', 160]]);
      await expect(frame.locator('[data-nl-page-gap]')).toHaveCount(0);
      expect(await frame.locator('p').last().evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
      await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
      if (i === 0) await page.reload();
    }
    expect(requests[0]!.system).toContain('a cohesive color palette');
  });

  test('new branches minimize other branches and can be reopened', async ({ page }) => {
    await seed(page, 'First source.\n\nSecond source.');
    await openProject(page); await newCanvas(page); await ask(page, 'explain');
    const select = async (text: string) => {
      await page.locator('.react-flow [data-part] p').filter({ hasText: text }).first().evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.getByTestId('add-source').click();
    };
    await select('First source.'); await ask(page, 'first question');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(2);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await select('Second source.'); await ask(page, 'second question');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(3);
    const first = page.locator('.react-flow [data-thread]').nth(1);
    await expect(first.getByRole('button', { name: 'Expand branch' })).toBeVisible();
    await expect(first).not.toContainText('first question');
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    // Overlap is intentional; the hierarchy exposes cards obscured by a newer branch.
    const firstId = await first.getAttribute('data-thread');
    await page.getByTestId('canvas-hierarchy-toggle').click();
    await page.getByTestId('canvas-hierarchy').locator(`[data-hierarchy-thread="${firstId}"]`).getByRole('button', { name: /^Locate / }).first().click();
    await expect(first).toContainText('first question');
    await expect(first.getByText('View full')).toHaveCount(0);
    await first.getByRole('button', { name: 'Minimize branch' }).click();
    await expect(first.getByRole('button', { name: 'Expand branch' })).toBeVisible();
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await page.reload();
    const restored = page.locator('.react-flow [data-thread]');
    await expect(restored).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Expand branch' })).toHaveCount(2);
    await expect(restored.nth(1)).not.toContainText('first question');
    await expect(restored.nth(2)).not.toContainText('second question');
    await expect(page.getByTestId('node-dims')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await restored.nth(1).getByRole('button', { name: 'Expand branch' }).click();
    await expect(restored.nth(1)).toContainText('first question');
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand branch' })).toHaveCount(2);
  });

  test('HTML elements can be selected and drilled into for a branch', async ({ page }) => {
    await seed(page, '<!doctype html><html><body><section><h2>Evidence</h2><p id="detail">A specific detail</p></section></body></html>');
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const frame = page.frameLocator('.react-flow iframe').first();
    await expect(frame.locator('#detail')).toBeVisible();
    await frame.locator('#detail').click();
    await expect(page.getByTestId('add-source')).toBeVisible();
    await frame.locator('#detail').dblclick();
    await expect(frame.getByRole('navigation', { name: 'Selected element hierarchy' })).toBeVisible();
    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('context-chips')).toContainText('A specific detail');
    await ask(page, 'explain this');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(2);
  });

  test('Ask branches from the entire blue-bordered HTML component', async ({ page }) => {
    await seed(page, '<body><section><h2>Migration risks</h2><div id="component" style="display:grid;grid-template-columns:1fr 1fr"><div><h3>Established from the repository</h3><ul><li id="detail">The backend is FastAPI.</li><li>Screening records use SQLite.</li></ul></div><div><h3>Implication</h3><ul><li>Cloud Run can host the application.</li><li>Decks must move to private object storage.</li></ul></div></div><p>Outside the component.</p></section></body>');
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const frame = page.frameLocator('.react-flow iframe').first();
    await frame.locator('#detail').click();
    await frame.locator('#detail').dblclick();
    await expect.poll(() => frame.locator('#component').evaluate(el => el.style.outline)).not.toBe('');
    await frame.locator('#detail').evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      selection.removeAllRanges(); document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByTestId('add-source').click();
    await expect(page.getByRole('textbox', { name: 'Ask about this canvas' })).toBeVisible();
    await expect(page.getByTestId('context-chips')).toContainText('Established from the repository');
    await ask(page, 'Explain the entire selected component');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(2);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    const canvasId = await page.getByTestId('canvas-workspace').getAttribute('data-canvas');
    const readSource = () => page.evaluate(async canvasId => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('notlinear-canvas'); r.onsuccess = () => resolve(r.result); });
      const content = await new Promise<string>(resolve => {
        const r = db.transaction('kv').objectStore('kv').get(`canvas_doc_v1:${canvasId}`);
        r.onsuccess = () => resolve(r.result.value.snapshots.at(-1).content);
      });
      db.close(); return content;
    }, canvasId);
    const content = await readSource();
    expect(content).toContain('Established from the repository');
    expect(content).toContain('Decks must move to private object storage.');
    expect(content).not.toContain('Outside the component.');
    await page.reload();
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(2);
    expect(await readSource()).toBe(content);
  });

  test('HTML table geometry stays intact after creating a branch', async ({ page }) => {
    await seed(page, `<body><section><h2>Stable table</h2><table style="width:100%;border-collapse:collapse">
      <tr><th>Layer</th> <th>Choice</th> <th>Constraint</th></tr>
      <tr><td>Application database</td> <td>Supabase PostgreSQL</td> <td>SQLite requires migration work</td></tr>
    </table></section></body>`);
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const frame = page.frameLocator('.react-flow iframe').first();
    await expect(frame.locator('table')).toBeVisible();
    const inspect = () => frame.locator('table').evaluate(el => ({
      html: el.innerHTML,
      boxes: Array.from(el.querySelectorAll('td,th')).map(n => {
        const r = n.getBoundingClientRect(); return [r.x,r.y,r.width,r.height];
      }),
    }));
    const before = await inspect();
    await frame.getByRole('heading', { name: 'Stable table' }).click();
    await page.getByTestId('add-source').click();
    await ask(page, 'Explain this table');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(2);
    await expect.poll(() => frame.locator('table').evaluate(() => CSS.highlights.size)).toBe(1);
    expect(await inspect()).toEqual(before);
    await page.reload();
    await expect.poll(() => frame.locator('table').evaluate(() => CSS.highlights.size)).toBe(1);
    expect(await inspect()).toEqual(before);
  });

  test('an HTML image can be selected as a branch source', async ({ page }) => {
    await seed(page, '<!doctype html><html><body><section><h2>Diagram</h2><img alt="System diagram" width="160" height="100"></section></body></html>');
    await openProject(page); await newCanvas(page); await ask(page, 'render as html');
    const frame = page.frameLocator('.react-flow iframe').first();
    await frame.getByAltText('System diagram').click();
    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('context-chips')).toContainText('System diagram');
    await ask(page, 'What is this?');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(2);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await page.reload();
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(2);
    await expect(page.locator('.react-flow [data-thread]').last()).toContainText('System diagram');
  });

  test('linear reading view selections can become a branch', async ({ page }) => {
    await seed(page, 'alpha **beta** gamma');
    await openProject(page); await newCanvas(page); await ask(page, 'explain');
    await expect(page.locator('.react-flow [data-part] strong')).toHaveText('beta');
    await page.getByTestId('canvas-reading-toggle').click();
    await page.getByTestId('canvas-reading').evaluate(el => { el.scrollTop = 200; });
    const readingScroll = await page.getByTestId('canvas-reading').evaluate(el => el.scrollTop);
    await page.getByTestId('canvas-reading').locator('[data-part] p').filter({ hasText: 'alpha beta gamma' }).evaluate(el => {
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(r);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('canvas-reading')).toBeVisible();
    await expect(page.getByTestId('context-chips')).toContainText('alpha beta gamma');
    await ask(page, 'why?');
    await expect(page.getByTestId('reading-branch')).toContainText('why?');
    expect(await page.getByTestId('canvas-reading').evaluate(el => el.scrollTop)).toBe(readingScroll);
    await page.getByRole('button', { name: 'Minimize' }).click();
    await expect(page.getByTestId('reading-branch')).toHaveCount(0);
    await page.getByRole('complementary', { name: 'Branches' }).getByRole('button').first().click();
    await expect(page.getByTestId('reading-branch')).toContainText('why?');
    expect(await page.getByTestId('canvas-reading').evaluate(el => el.scrollTop)).toBe(readingScroll);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await page.reload();
    await page.getByTestId('canvas-reading-toggle').click();
    await page.getByRole('complementary', { name: 'Branches' }).getByRole('button').first().click();
    await expect(page.getByTestId('reading-branch')).toContainText('why?');
  });

  test('switching branches while a reply is pending keeps the source in place', async ({ page }) => {
    await seed(page, 'First passage.\n\nSecond passage.\n\n' + Array.from({ length: 70 }, (_, i) => `Paragraph ${i}`).join('\n\n'));
    await openProject(page); await newCanvas(page); await ask(page, 'explain');
    await page.getByTestId('canvas-reading-toggle').click();
    const reader = page.getByTestId('canvas-reading');
    const select = async (text: string) => {
      await reader.locator('[data-part] p').filter({ hasText: text }).evaluate(el => {
        const r = document.createRange(); r.selectNodeContents(el);
        const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
      });
      await page.getByTestId('add-source').click();
    };
    await select('First passage.'); await ask(page, 'first question');
    await expect(page.getByTestId('reading-branch')).toContainText('first question');
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await page.route('https://api.anthropic.com/v1/messages', async route => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Delayed answer' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      ];
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
    });
    await reader.evaluate(el => { el.scrollTop = 200; });
    const scroll = await reader.evaluate(el => el.scrollTop);
    await select('Second passage.'); await ask(page, 'second question');
    const branches = page.getByRole('complementary', { name: 'Branches' });
    await expect(branches.locator('button[aria-pressed]')).toHaveCount(2);
    await branches.locator('button[aria-pressed]').first().click();
    await expect(page.getByTestId('reading-branch')).toContainText('first question');
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await branches.locator('button[aria-pressed]').nth(1).click();
    await expect(page.getByTestId('reading-branch')).toContainText('Delayed answer');
    expect(await reader.evaluate(el => el.scrollTop)).toBe(scroll);
  });

  test('a populated canvas settles while idle and stops observing after leaving', async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => {
      const state = window as unknown as Window & { sceneObservers: number };
      state.sceneObservers = 0;
      const Native = window.MutationObserver;
      window.MutationObserver = class extends Native {
        private scene = false;
        override observe(target: Node, options?: MutationObserverInit): void {
          if (!this.scene && target instanceof Element && target.matches('.react-flow__nodes')) {
            this.scene = true; state.sceneObservers++;
          }
          super.observe(target, options);
        }
        override disconnect(): void {
          if (this.scene) { this.scene = false; state.sceneObservers--; }
          super.disconnect();
        }
      };
    });
    await openProject(page); await newCanvas(page);
    const id = (await page.getByTestId('canvas-workspace').getAttribute('data-canvas'))!;
    const fixture = emptyDoc({ id, title: 'Performance fixture', projectId: 'p1', rev: 2, createdAt: 1, updatedAt: 1, counts: { threads: 0, messages: 0, outputs: 0 } });
    for (let i = 0; i < 50; i++) {
      const { thread } = createRootThread(fixture, `Question ${i}`, { now: i + 1 });
      const reply = addMessage(fixture, { threadId: thread.id, author: { kind: 'model', provider: 'p', model: 'm' }, parts: [textPart('A readable paragraph. '.repeat(30))] }, { now: i + 1 });
      setGeometry(fixture, thread.id, { x: (i % 5) * 400, y: Math.floor(i / 5) * 340, w: 360, h: 300 });
      if (i === 0) {
        const source = freezeSelection(fixture, reply.id, reply.parts[0]!.id, 'readable', 2, { now: 1 })!;
        const made = branchFrom(fixture, { snapshotId: source.id, prompt: 'why readable?' }, { now: 2 })!;
        setGeometry(fixture, made.thread.id, { x: 2200, y: 0, w: 360, h: 300 });
      }
    }
    fixture.summary.counts = { threads: fixture.threads.length, messages: fixture.messages.length, outputs: 0 };
    await page.evaluate(async fixture => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('notlinear-canvas'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ key: `canvas_doc_v1:${fixture.summary.id}`, value: fixture });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); db.close();
    }, fixture);
    await page.reload();
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(51);
    await expect.poll(() => page.evaluate(() => (window as unknown as Window & { sceneObservers: number }).sceneObservers)).toBe(1);
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    const mutations = await page.locator('.react-flow__nodes').evaluate(el => new Promise<number>(resolve => {
      let count = 0; const observer = new MutationObserver(changes => { count += changes.length; });
      observer.observe(el, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(count); }, 800);
    }));
    expect(mutations).toBe(0);
    await page.getByRole('tab').filter({ hasText: 'Main' }).getByRole('button').first().click();
    await expect(page.locator('.react-flow')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Window & { sceneObservers: number }).sceneObservers)).toBe(0);
  });

  test('a slow stream finishes in its original canvas after switching away', async ({ page }) => {
    await seed(page);
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.includes('api.anthropic.com/v1/messages')) return original(input, init);
        const encode = (e: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`);
        return new Response(new ReadableStream({
          async start(controller) {
            controller.enqueue(encode({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }));
            for (let i = 0; i < 40; i++) {
              controller.enqueue(encode({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `word${i} ` } }));
              await new Promise(resolve => setTimeout(resolve, 60));
            }
            controller.enqueue(encode({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }));
            controller.close();
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      };
    });
    await openProject(page); await newCanvas(page); await ask(page, 'slow answer');
    await expect(page.getByTestId('live-text')).toContainText('word0');
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
    await newCanvas(page);
    await openComposer(page);
    await page.getByTestId('ink-composer').getByRole('textbox').fill('second canvas draft');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(0);
    await canvasTab(page).first().getByRole('button').first().click();
    await expect(page.locator('.react-flow')).toContainText('word39', { timeout: 10000 });
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
    await canvasTab(page).nth(1).getByRole('button').first().click();
    await expect(page.getByTestId('ink-composer').getByRole('textbox')).toHaveValue('second canvas draft');
    await expect(page.locator('.react-flow [data-thread]')).toHaveCount(0);
  });

  test('a backward drag at reduced zoom selects the second repeated phrase', async ({ page }) => {
    await seed(page, 'echo then **echo**');
    await openProject(page); await newCanvas(page); await ask(page, 'repeat');
    const second = page.locator('.react-flow [data-part] strong');
    await expect(second).toHaveText('echo');
    await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
    const rect = (await second.boundingBox())!;
    await page.mouse.move(rect.x + rect.width - 0.3, rect.y + rect.height / 2); await page.mouse.down();
    await page.mouse.move(rect.x + 0.3, rect.y + rect.height / 2, { steps: 10 }); await page.mouse.up();
    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('context-chips')).toContainText('echo');
    await ask(page, 'why this one?');
    await page.reload();
    const firstCard = page.locator('.react-flow [data-thread]').first();
    await expect(firstCard.locator('strong mark')).toHaveText('echo');
    expect(await firstCard.locator('[data-part] p').last().innerHTML()).toMatch(/^.*echo then/);
  });

  test('ask, stream a reply, and keep it across a reload', async ({ page }) => {
    const requests = await seed(page);
    await openProject(page);
    await newCanvas(page);

    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages.at(-1)!.content).toBe('what is a widget?');

    await page.reload();
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();
  });

  test('text inside a card is selectable, and a selection becomes a branch with its source', async ({ page }) => {
    const requests = await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    // React Flow sets user-select:none on nodes; without the override this selects nothing and the
    // whole branching gesture is dead. That is the C0 spike's first finding, asserted here.
    const selected = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-part]')].find(n => n.textContent?.includes('sprocket'));
      if (!el) return '';
      // The part renders markdown, so the word sits in a text node somewhere inside it.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null = null;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes('sprocket')) { node = walker.currentNode; break; }
      }
      if (!node) return '';
      const text = node.textContent ?? '';
      const at = text.indexOf('sprocket');
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 'sprocket'.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return sel.toString();
    });
    expect(selected).toBe('sprocket');

    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('context-chips')).toContainText('sprocket');

    await ask(page, 'what does it do?');
    // Scoped: the sidebar's thread rows carry `data-thread` too.
    await expect(page.getByTestId('canvas-workspace').locator('[data-thread]')).toHaveCount(2);
    // The branch card is created before the asynchronous provider request is sent.
    await expect.poll(() => requests.length).toBe(2);
    // the branch carried the excerpt and the ancestor exchange
    const last = requests.at(-1)!;
    expect(last.messages.at(-1)!.content).toContain('> sprocket');
    expect(last.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  test('a branch connector anchors to the highlighted quote, including after a reload', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-part]')].find(n => n.textContent?.includes('sprocket'));
      const walker = document.createTreeWalker(el!, NodeFilter.SHOW_TEXT);
      let node: Node | null = null;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes('sprocket')) { node = walker.currentNode; break; }
      }
      const text = node!.textContent ?? '';
      const at = text.indexOf('sprocket');
      const range = document.createRange();
      range.setStart(node!, at);
      range.setEnd(node!, at + 'sprocket'.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByTestId('add-source').click();
    await ask(page, 'what does it do?');
    await expect(page.getByTestId('canvas-workspace').locator('[data-thread]')).toHaveCount(2);

    // The edge's real rendered start point (via the SVG path's own screen CTM, so pan/zoom/transform
    // don't matter) should land exactly on the highlighted mark's screen position, not the source
    // card's border. Checked after a reload — a cold hydration from IndexedDB, not a live update —
    // since that is the path that regressed (bug: measuring in a `useLayoutEffect` ran before the
    // mark existed, because the mark is created by a descendant's `useEffect`; a `useLayoutEffect`
    // in a parent fires before any passive effect anywhere in the tree, so it always lost the race
    // on first mount and never got a second chance since nothing else re-triggered it).
    await page.reload();
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();
    await page.waitForSelector('.react-flow__edge-path');
    const matchesQuote = async (): Promise<void> => {
      const { markPoint, startScreen } = await page.evaluate(() => {
      const mark = document.querySelector('mark[data-snapshot-id]') as HTMLElement;
      const path = document.querySelector('.react-flow__edge-path') as SVGPathElement;
      const markRect = mark.getBoundingClientRect();
      const svg = path.ownerSVGElement!;
      const pt = svg.createSVGPoint();
      const start = path.getPointAtLength(0);
      pt.x = start.x; pt.y = start.y;
      const screen = pt.matrixTransform(path.getScreenCTM()!);
      return {
        markPoint: { x: markRect.right, y: markRect.top + markRect.height / 2 },
        startScreen: { x: screen.x, y: screen.y },
      };
    });
      expect(startScreen.x).toBeCloseTo(markPoint.x, 0);
      expect(startScreen.y).toBeCloseTo(markPoint.y, 0);
    };
    await expect(matchesQuote).toPass({ timeout: 7000 });
    const sourceHeader = page.locator('.react-flow [data-thread]').first().locator('header > span').first();
    const rect = (await sourceHeader.boundingBox())!;
    await page.mouse.move(rect.x + 12, rect.y + rect.height / 2); await page.mouse.down();
    await page.mouse.move(rect.x + 132, rect.y + rect.height / 2 + 60, { steps: 10 }); await page.mouse.up();
    await expect(matchesQuote).toPass({ timeout: 7000 });

  });

  test('two canvases keep their own tabs, drafts and content across a reload', async ({ page }) => {
    await seed(page);
    await openProject(page);

    await newCanvas(page);
    await openComposer(page);
    await page.getByTestId('ink-composer').getByRole('textbox').fill('draft for the first');
    const firstTab = await canvasTab(page).first().innerText();

    // back to the project, make a second canvas
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
    await newCanvas(page);
    await openComposer(page);
    await page.getByTestId('ink-composer').getByRole('textbox').fill('draft for the second');

    await expect(page.getByRole('tab')).toHaveCount(3); // main chat + two canvases
    // The draft is written on a 250ms debounce; a reload is not an unmount, so let it land.
    await page.waitForTimeout(400);
    await page.reload();

    // Both tabs come back, each with its own identity — the thing Notes' singleton tab got wrong.
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();
    // and the draft that belongs to the canvas showing is the one that comes back
    await expect(page.getByTestId('ink-composer').getByRole('textbox')).toHaveValue('draft for the second');
    expect(firstTab).toBeTruthy();
  });

  test('a reply saves into the project as an artifact, and saving twice does not duplicate it', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    const save = page.getByTestId('save-output');
    await save.dispatchEvent('click');
    await expect.poll(async () => (await artifacts(page)).length).toBe(1);

    const first = (await artifacts(page))[0]!;
    expect(first).toMatchObject({ source: 'canvas', version: 1 });
    expect(first.canvasOutputVersionId).toBeTruthy();

    // Saving the same output again must not make a second artifact: the operation record is
    // deterministic and a retry resumes it.
    await save.dispatchEvent('click');
    await page.waitForTimeout(500);
    expect(await artifacts(page)).toHaveLength(1);

    // and it shows up on the project screen
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
    await expect(page.getByTestId('card-artifacts')).toContainText('1');
  });

  test('a send that fails says so instead of sitting there', async ({ page }) => {
    await seed(page);
    // the provider refuses: the canvas must say what happened, not go quiet
    await page.route('https://api.anthropic.com/v1/messages', r => r.fulfill({ status: 401, body: 'nope' }));
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');

    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 15000 });
    // and the indicator does not sit on "Saving…" claiming work that is not happening
    await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved', { timeout: 15000 });
  });

  test('the reading view shows the same threads, and goes back to the canvas', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    await page.getByTestId('canvas-reading-toggle').click();
    await expect(page.getByTestId('canvas-reading')).toBeVisible();
    await expect(page.getByTestId('canvas-reading')).toContainText('A widget has a sprocket and a flange.');
    await page.getByRole('button', { name: 'Back to the canvas' }).click();
    await expect(page.getByTestId('canvas-reading')).toHaveCount(0);
  });

  test('the library creates, renames, duplicates and deletes', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await page.getByTestId('card-canvases').getByRole('button', { name: 'Open Canvases' }).click();
    await expect(page.getByTestId('canvases-view')).toBeVisible();

    await page.getByTestId('canvas-new').click();
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
    await page.getByTestId('card-canvases').getByRole('button', { name: 'Open Canvases' }).click();

    await page.getByRole('button', { name: /^Rename/ }).click();
    await page.getByLabel('Canvas name').fill('Widgets');
    await page.getByLabel('Canvas name').press('Enter');
    await expect(page.getByTestId('canvases-view')).toContainText('Widgets');

    await page.getByRole('button', { name: /^Duplicate/ }).click();
    await expect(page.getByTestId('canvases-view')).toContainText('Widgets copy');

    await page.getByRole('button', { name: 'Delete Widgets copy' }).click();
    await page.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(page.getByTestId('canvases-view')).not.toContainText('Widgets copy');
  });

  test('search (⌘K) finds a reply, opens it full, and Esc closes it over the canvas (UI-08/UI-09)', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    // The chat palette has no concept of a canvas reply; this must be the canvas-native one.
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search this canvas' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('sprocket');
    await dialog.getByRole('option').first().click();

    const detail = page.getByTestId('canvas-output-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('A widget has a sprocket and a flange.');

    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();
  });

  test('"View full" on a card opens the same output-detail view', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    await page.getByTestId('view-output').click();
    await expect(page.getByTestId('canvas-output-detail')).toBeVisible();
    await page.getByTestId('output-detail-close').click();
    await expect(page.getByTestId('canvas-output-detail')).toHaveCount(0);
  });
});


test('a project Canvas sends linked repository evidence and folder tools to the provider', async ({ page }) => {
  const requests = await seed(page, 'Orion orchestrates Vega.', '/fixture/agents-repo');
  await page.route('**/__notlinear_scan_project', async route => {
    expect(route.request().postDataJSON()).toEqual({ path: '/fixture/agents-repo' });
    await route.fulfill({ json: { ok: true, contextFiles: [
      { present: true, filename: 'agents.ts', relativePath: 'src/agents.ts', text: 'Orion orchestrates Vega in the repository.' },
    ] } });
  });
  await openProject(page); await newCanvas(page); await ask(page, 'Explain the repository agents');
  await expect(page.locator('.react-flow [data-part]').filter({ hasText: 'Orion orchestrates Vega.' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.system).toContain('src/agents.ts');
  expect(requests[0]!.system).toContain('Orion orchestrates Vega in the repository.');
  expect(requests[0]!.tools?.map(t => t.name)).toEqual(expect.arrayContaining(['list_project_files', 'read_project_file']));
  await expect(page.getByTestId('canvas-status')).not.toBeVisible();
});

test('Canvas slash skills are reachable, keep multiple picks, and reach only the chosen turn', async ({ page }) => {
  const requests = await seed(page, 'Noted.');
  await openProject(page); await newCanvas(page); await openComposer(page);
  const composer = page.getByTestId('ink-composer');
  const box = composer.getByRole('textbox');
  const menu = page.getByRole('listbox', { name: 'Skills' });
  await box.fill('Help with this plan /');
  await expect(menu).toBeVisible();
  const first = menu.locator('[data-skill-option]').first();
  // Visibility alone misses overflow clipping: the option must actually receive a pointer.
  await expect.poll(() => first.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })).toBe(true);
  await page.screenshot({ path: '/tmp/notlinear-canvas-skills.png' });
  // Reposition the same open menu after a window resize; it must stay clickable and bounded.
  await page.setViewportSize({ width: 640, height: 480 });
  await expect.poll(() => first.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })).toBe(true);
  const bounds = await menu.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(8);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
  await box.fill('Help with this plan /pre-mor');
  await menu.locator('[data-skill-option="pre-mortem"]').click();
  await expect(composer.getByTestId('picked-skills')).toContainText('pre-mortem');
  await expect(box).toHaveValue('Help with this plan');
  await expect(menu).toBeVisible();
  await box.fill('Help with this plan /steelman');
  await box.press('Enter');
  await expect(composer.getByTestId('picked-skills')).toContainText('steelman');
  await box.press('Escape');
  await expect(menu).toBeHidden();
  await expect(composer).toBeVisible();
  await box.press('Enter');
  await expect.poll(() => requests.length).toBe(1);
  expect(JSON.stringify(requests[0]!.system)).toContain('### Skill: pre-mortem');
  expect(JSON.stringify(requests[0]!.system)).toContain('### Skill: steelman');
  await expect(page.getByTestId('picked-skills')).toBeHidden();
  await expect(page.locator('.react-flow')).toContainText('Noted.');
  await ask(page, 'hello again');
  await expect.poll(() => requests.length).toBe(2);
  expect(JSON.stringify(requests[1]!.system)).not.toContain('### Skill: pre-mortem');
  expect(JSON.stringify(requests[1]!.system)).not.toContain('### Skill: steelman');
});

test('Canvas header edits persist and navigation remains above it with autohide', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nl_autohide_bars', '1'));
  await seed(page);
  await page.goto('/web/');
  await expect(page.getByRole('tablist', { name: 'Open tabs' })).toBeAttached();
  await page.mouse.move(800, 400);
  await page.mouse.move(200, 2);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
  await newCanvas(page);
  await page.mouse.move(800, 400);
  const title = page.getByTestId('canvas-title');
  await title.click();
  const input = page.getByRole('textbox', { name: 'Canvas name' });
  await input.fill('Research map'); await input.press('Enter');
  await expect(title).toHaveText('Research map');
  await expect(page.getByTestId('crumb-trail')).toContainText('Research');
  await expect(page.getByTestId('crumb-here')).toHaveText('Research map');
  const crumb = await page.locator('[data-topbar]').boundingBox();
  const header = await title.boundingBox();
  expect(crumb!.y + crumb!.height).toBeLessThanOrEqual(header!.y);
  await title.click(); await input.fill('Cancelled'); await input.press('Escape');
  await expect(title).toHaveText('Research map');
  await title.click(); await input.fill('   '); await input.press('Enter');
  await expect(title).toHaveText('Research map');
  await page.getByRole('button', { name: 'Set canvas icon' }).click();
  const icon = page.getByTestId('glyph-picker').locator('[data-icon]').first();
  await expect(icon).toBeVisible();
  await icon.click();
  await expect(page.getByRole('button', { name: 'Set canvas icon' }).locator('.mg-glyph')).toBeVisible();
  await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
  await page.reload();
  await expect(title).toHaveText('Research map');
  await expect(page.getByRole('button', { name: 'Set canvas icon' }).locator('.mg-glyph')).toBeVisible();
  await page.mouse.move(220, 2);
  const tab = page.getByRole('tab').filter({ hasText: 'Research map' });
  await expect(tab).toBeVisible();
  await tab.click();
  await page.mouse.move(800, 400);
  await page.getByTestId('canvas-reading-toggle').click();
  await expect(title).toHaveText('Research map');
  await page.mouse.move(220, 2);
  await tab.click();
  const toggle = page.getByRole('button', { name: 'Open left pane' });
  const assertToggleBelowTabs = async () => {
    await page.mouse.move(220, 2);
    await expect.poll(async () => {
      const tabs = await page.getByRole('tablist', { name: 'Open tabs' }).boundingBox();
      const button = await toggle.boundingBox();
      return !!tabs && !!button && button.y >= tabs.y + tabs.height;
    }).toBe(true);
    const before = await toggle.getAttribute('aria-expanded');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
  };
  await assertToggleBelowTabs();
  await page.mouse.move(800, 400);
  await page.getByTestId('canvas-reading-toggle').click();
  await assertToggleBelowTabs();
  await page.mouse.move(800, 400);
  await page.waitForTimeout(450);
  await page.screenshot({ path: '/tmp/notlinear-canvas-navigation-hidden.png' });
  await page.mouse.move(220, 2);
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/tmp/notlinear-canvas-navigation-shown.png' });
});


test('pasted canvas images preview, stack, reload, and stay available for follow-up', async ({ page }) => {
  const requests = await seed(page, 'I can see both images.');
  await openProject(page); await newCanvas(page);
  const surface = page.getByLabel('Canvas workspace', { exact: true });
  await surface.focus();
  await surface.evaluate(el => {
    const data = new DataTransfer();
    for (const name of ['first.png', 'second.png']) {
      const image = document.createElement('canvas'); image.width = 240; image.height = 100;
      const ctx = image.getContext('2d')!;
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 240, 100);
      ctx.fillStyle = 'black'; ctx.font = '20px sans-serif'; ctx.fillText(name, 20, 55);
      const bytes = Uint8Array.from(atob(image.toDataURL('image/png').split(',')[1]!), c => c.charCodeAt(0));
      data.items.add(new File([bytes], name, { type: 'image/png' }));
    }
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const composer = page.getByTestId('ink-composer');
  await expect(composer.getByRole('img')).toHaveCount(2);
  const preview = composer.getByRole('img').first();
  expect((await preview.boundingBox())!.height).toBeGreaterThan(50);
  await preview.click();
  await expect(page.getByRole('dialog', { name: 'Image preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await ask(page, 'Compare these images');
  const pictures = page.locator('.react-flow button[aria-label^="Preview "] img');
  await expect(pictures).toHaveCount(2);
  await expect.poll(() => pictures.first().evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(240);
  const first = (await pictures.nth(0).boundingBox())!;
  const second = (await pictures.nth(1).boundingBox())!;
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
  expect(JSON.stringify(requests.at(-1))).toContain('"type":"image"');
  await page.reload();
  await expect(pictures).toHaveCount(2);
  await pictures.first().click();
  await expect(page.getByRole('dialog', { name: 'Image preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Clicking the card targets a continuation of the saved thread.
  await page.locator('.react-flow [data-message]').first().getByText('You', { exact: true }).click();
  await ask(page, 'What do they have in common?');
  await expect.poll(() => requests.length).toBe(2);
  const content = requests.at(-1)!.messages[0]!.content as unknown as { type: string }[];
  expect(content.filter(b => b.type === 'image')).toHaveLength(2);
  await page.screenshot({ path: '/private/tmp/notlinear-image-previews.png' });
});

// A held provider request is essential: an instant mock never exposes a workspace-wide lock.
test('a generating Canvas branch does not block another selected source', async ({ page }) => {
  await seed(page);
  await openProject(page); await newCanvas(page); await ask(page, 'Explain widgets');
  const source = page.locator('.react-flow [data-part] p').filter({ hasText: 'A widget has a sprocket and a flange.' }).first();
  await expect(source).toBeVisible();
  const held: { release(): void; text: string }[] = [];
  await page.route('https://api.anthropic.com/v1/messages', async route => {
    const index = held.length;
    await new Promise<void>(release => { held.push({ release, text: `Concurrent answer ${index + 1}` }); });
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `Concurrent answer ${index + 1}` } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') }).catch(() => undefined);
  });
  const pick = async () => {
    await source.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByTestId('add-source').click();
  };
  try {
    await pick(); await ask(page, 'First concurrent branch');
    await expect.poll(() => held.length).toBe(1);
    const firstId = await page.locator('.react-flow [data-thread]').last().getAttribute('data-thread');
    await pick();
    const composer = page.getByTestId('ink-composer');
    await composer.getByRole('textbox').fill('Second concurrent branch');
    await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await composer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => held.length).toBe(2);
    const secondId = await page.locator('.react-flow [data-thread]').last().getAttribute('data-thread');
    // Completing the first must not clear the second's Stop control.
    held[0]!.release();
    const first = page.locator(`.react-flow [data-thread="${firstId}"]`);
    await first.locator('header').dispatchEvent('click');
    await expect(first).toContainText('Concurrent answer 1');
    const second = page.locator(`.react-flow [data-thread="${secondId}"]`);
    await second.locator('header').dispatchEvent('click');
    await expect(composer.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await composer.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(composer.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await expect(first).toContainText('Concurrent answer 1');
  } finally {
    held.forEach(h => h.release());
  }
});


test('Canvas branches stay beside the selected passage and the newest overlapping card is in front', async ({ page }) => {
  await seed(page);
  await openProject(page); await newCanvas(page); await ask(page, 'Explain widgets');
  const source = page.locator('.react-flow [data-part] p').filter({ hasText: 'A widget has a sprocket and a flange.' }).first();
  await expect(source).toBeVisible();
  const pick = async () => {
    let previous: string | null = null;
    await expect.poll(async () => {
      const current = await page.locator('.react-flow__viewport').getAttribute('style');
      const settled = previous === current; previous = current; return settled;
    }).toBe(true);
    await source.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByTestId('add-source').click();
  };
  await pick(); await ask(page, 'First nearby branch');
  const cards = page.locator('.react-flow__node');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toContainText('A widget has a sprocket and a flange.');
  const firstId = (await cards.nth(1).getAttribute('data-id'))!;
  const firstY = await cards.nth(1).evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42);
  await pick(); await ask(page, 'Second nearby branch');
  await expect(cards).toHaveCount(3);
  const second = cards.nth(2);
  await expect(second).toContainText('A widget has a sprocket and a flange.');
  const secondId = (await second.getAttribute('data-id'))!;
  await expect.poll(async () => Math.abs(await second.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42) - firstY)).toBeLessThan(2);
  const first = page.locator(`.react-flow__node[data-id="${firstId}"]`);
  expect(await second.evaluate(el => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(await first.evaluate(el => Number(getComputedStyle(el).zIndex)));
  await expect.poll(() => second.locator('header').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.left + Math.min(30, rect.width / 2), rect.top + rect.height / 2));
  })).toBe(true);
  // Saved placement survives remount; the existing collapse-on-open rule still applies.
  await expect(page.getByTestId('canvas-workspace')).toContainText('Saved');
  await page.reload();
  const restored = page.locator(`.react-flow__node[data-id="${secondId}"]`);
  await expect(restored).toBeVisible();
  expect(Math.abs(await restored.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42) - firstY)).toBeLessThan(2);
});


test('a child keeps its parent expanded and in focus while unrelated branches collapse', async ({ page }) => {
  await seed(page);
  await openProject(page); await newCanvas(page); await ask(page, 'Main question');
  const pick = async (cardIndex: number) => {
    let previous: string | null = null;
    await expect.poll(async () => {
      const current = await page.locator('.react-flow__viewport').getAttribute('style');
      const settled = previous === current; previous = current; return settled;
    }).toBe(true);
    const paragraph = page.locator('.react-flow [data-thread]').nth(cardIndex).locator('[data-part] p').filter({ hasText: 'A widget has a sprocket and a flange.' }).first();
    await expect(paragraph).toBeVisible();
    await paragraph.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByTestId('add-source').click();
  };
  await pick(0); await ask(page, 'Unrelated branch');
  await expect(page.locator('.react-flow [data-thread]').nth(1)).toContainText('A widget has a sprocket and a flange.');
  await pick(0); await ask(page, 'Parent branch');
  const cards = page.locator('.react-flow [data-thread]');
  await expect(cards.nth(2)).toContainText('A widget has a sprocket and a flange.');
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
  await pick(2);
  await ask(page, 'Child branch');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(3)).toContainText('A widget has a sprocket and a flange.');
  await expect(cards.nth(2)).toContainText('Parent branch');
  await expect(cards.nth(2).getByRole('button', { name: 'Minimize branch' })).toBeVisible();
  await expect(cards.nth(3).getByRole('button', { name: 'Minimize branch' })).toBeVisible();
  await expect(cards.nth(1).getByRole('button', { name: 'Expand branch' })).toBeVisible();
  await expect(cards.nth(0)).toContainText('Main question');
  await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
  await expect.poll(async () => {
    const parent = await cards.nth(2).boundingBox();
    const child = await cards.nth(3).boundingBox();
    const pane = await page.locator('.react-flow').boundingBox();
    return !!parent && !!child && !!pane && parent.x >= pane.x && parent.x + parent.width <= pane.x + pane.width && child.x < pane.x + pane.width - 50;
  }).toBe(true);
  const viewport = await page.locator('.react-flow__viewport').getAttribute('style');
  // Settling node measurements must not reframe onto the child.
  await expect(page.getByTestId('canvas-save-state')).toHaveText('Saved');
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', viewport!);
  await page.screenshot({ path: test.info().outputPath('parent-and-child.png'), animations: 'disabled' });
});

test('Canvas notifications open the originating thread and keep read history', async ({ page }) => {
  await seed(page);
  await openProject(page);
  await newCanvas(page);
  await ask(page, 'Explain the widget');
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  const panel = page.getByRole('region', { name: 'Canvas notifications' });
  await expect(panel.getByText('Your reply is ready')).toBeVisible();
  await panel.getByRole('button').filter({ hasText: 'Your reply is ready' }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 0 unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications, 0 unread' }).click();
  await expect(panel.getByText('Your reply is ready')).toBeVisible();
  await panel.getByRole('button', { name: 'Unread · 0' }).click();
  await expect(panel.getByText('All caught up')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 0 unread' })).toBeFocused();
});
