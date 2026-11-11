import { test, expect } from '@playwright/test';
import { withSelectionBridge } from '../../src/canvas/view/html-bridge';

test('branch highlights preserve table/grid structure, geometry and authored colors', async ({ page }) => {
  await page.setContent('<iframe sandbox="allow-scripts" style="width:880px;height:640px"></iframe>');
  await page.evaluate(() => window.addEventListener('message', e => {
    if (e.data?.type === 'selection' && e.data.text) document.body.dataset.quote = e.data.text;
    if (e.data?.type === 'anchors') document.body.dataset.anchors = JSON.stringify(e.data.marks);
  }));
  const html = `<body><style>
    table { width:100%;border-collapse:collapse } td,th { padding:12px;border:1px solid gray }
    th { color:white;background:seagreen } .chart { display:grid;grid-template-columns:1fr 3fr 1fr;gap:12px }
  </style><section><h2>Comparison</h2><table>
    <tr>
      <th>Layer</th>
      <th>Recommended choice</th>
      <th>Constraint</th>
    </tr>
    <tr>
      <td>Application database</td>
      <td>Supabase PostgreSQL</td>
      <td>SQLite requires migration work</td>
    </tr>
  </table><div class="chart">
    Option <span>Score</span> Total
    <span>Supabase</span> <span>4.7</span> <span>Good fit</span>
  </div></section></body>`;
  await page.locator('iframe').evaluate((el, source) => { (el as HTMLIFrameElement).srcdoc = source; }, withSelectionBridge(html));
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Comparison' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-quote', /Supabase/);
  const inspect = () => frame.locator('section').evaluate(el => ({
    html: el.innerHTML,
    boxes: Array.from(el.querySelectorAll('table,td,th,.chart,.chart>span')).map(n => {
      const r = n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];
    }),
    color: getComputedStyle(el.querySelector('th')!).color,
  }));
  const before = await inspect();
  const quote = await page.locator('body').getAttribute('data-quote');
  for (const [id, color] of [['blue-source', 'rgb(184, 216, 255)'], ['pink-source', 'rgb(245, 190, 222)']]) {
    await page.locator('iframe').evaluate((el, mark) => (el as HTMLIFrameElement).contentWindow!.postMessage({ __nlHtmlCommand:'marks', marks:[mark] }, '*'), { id, quote, occurrence:0, color });
    await expect.poll(async () => JSON.parse(await page.locator('body').getAttribute('data-anchors') || '[]').map((a: {id:string}) => a.id)).toEqual([id]);
    expect(await inspect()).toEqual(before);
    expect(await frame.locator('section').evaluate(() => CSS.highlights.size)).toBe(1);
    const highlightRule = await frame.locator('section').evaluate(() => document.querySelector('[data-nl-highlights]')?.textContent);
    expect(highlightRule).toContain('35%');
    expect(highlightRule).not.toContain('color: black');
  }
  await page.locator('iframe').evaluate(el => (el as HTMLIFrameElement).contentWindow!.postMessage({ __nlHtmlCommand:'marks', marks:[] }, '*'));
  await expect.poll(() => frame.locator('section').evaluate(() => CSS.highlights.size)).toBe(0);
  expect(await inspect()).toEqual(before);
});
