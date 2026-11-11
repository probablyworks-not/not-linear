import { test, expect } from '@playwright/test';
import { withSelectionBridge } from '../../src/canvas/view/html-bridge';

for (const position of ['sticky', 'fixed', 'absolute']) {
  test(`complete HTML keeps ${position} navigation, section selection and real wheel reading`, async ({ page }) => {
    await page.setContent('<main style="height:500px;overflow:auto"><iframe sandbox="allow-scripts" style="width:880px;height:640px;border:0"></iframe></main>');
    await page.evaluate(() => window.addEventListener('message', e => {
      if (e.data?.type === 'pagination') {
        document.querySelector('iframe')!.style.height = `${e.data.height}px`;
        document.body.dataset.fallback = e.data.fallback || '';
      }
      if (e.data?.type === 'wheel') document.querySelector('main')!.scrollTop += e.data.deltaY;
    }));
    const html = `<body style="height:100vh;overflow:auto"><style>nav{position:${position};top:0;height:30px}section{padding:40px 0}td{padding:12px}</style>
      <nav>Overview · Pipeline · Agents</nav><section><h2>Pipeline overview</h2>
      <div style="position:relative"><span style="position:absolute;right:0;top:0">Annotation</span></div>
      <p>Report content</p>${'<p>Follow the workflow</p>'.repeat(60)}
      <details><summary>Expand final stage</summary><p>Additional detail</p>${'<p>Expanded stage detail</p>'.repeat(15)}</details>
      <table><tr><td>Final output</td><td>Saved record</td></tr></table><p>End of complete report</p></section></body>`;
    await page.locator('iframe').evaluate((el, source) => { (el as HTMLIFrameElement).srcdoc = source; }, withSelectionBridge(html, false, true));
    const frame = page.frameLocator('iframe');
    await expect.poll(() => page.locator('iframe').evaluate(el => el.clientHeight)).toBeGreaterThan(1500);
    await expect(page.locator('body')).toHaveAttribute('data-fallback', '');
    await expect(frame.locator('[data-nl-page-gap]')).toHaveCount(0);
    const before = await page.locator('iframe').evaluate(el => el.clientHeight);
    await frame.getByRole('heading', { name: 'Pipeline overview' }).click();
    await expect(frame.getByRole('navigation', { name: 'Selected element hierarchy' })).toBeVisible();
    await page.locator('iframe').evaluate(el => (el as HTMLIFrameElement).contentWindow!.postMessage({ __nlHtmlCommand:'paginate' }, '*'));
    await expect.poll(() => page.locator('iframe').evaluate(el => el.clientHeight)).toBe(before);
    await expect(page.locator('body')).toHaveAttribute('data-fallback', '');
    await page.locator('iframe').hover({ position:{x:300,y:180} });
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.locator('main').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    expect(await frame.locator('body').evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    await frame.getByText('Expand final stage').evaluate(el => (el as HTMLElement).click());
    await expect.poll(() => page.locator('iframe').evaluate(el => el.clientHeight)).toBeGreaterThan(before + 100);
    expect(await frame.getByText('End of complete report').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
    await expect(frame.locator('table tr')).toHaveCount(1);
    await page.mouse.wheel(0, 10000);
    await expect(frame.getByText('End of complete report')).toBeInViewport();
    await page.screenshot({ path:test.info().outputPath('continuous-reading.png') });
  });
}
