import { test, expect } from '@playwright/test';
import { withSelectionBridge } from '../../src/canvas/view/html-bridge';

test('section inspection preserves the full report and its final passage', async ({ page }) => {
  await page.setContent('<iframe sandbox="allow-scripts" style="width:880px;height:640px"></iframe>');
  await page.evaluate(() => {
    window.addEventListener('message', e => {
      if (e.data?.type !== 'pagination') return;
      document.body.dataset.layouts = String(Number(document.body.dataset.layouts || '0') + 1);
      document.querySelector('iframe')!.style.height = `${e.data.height}px`;
      document.body.dataset.fallback = e.data.fallback || '';
    });
  });
  const html = '<body><section><h1>Complete report</h1>' + '<p>Reading content</p>'.repeat(90) + '<p>Final passage</p></section></body>';
  await page.locator('iframe').evaluate((el, source) => { (el as HTMLIFrameElement).srcdoc = source; }, withSelectionBridge(html, false, true));
  const frame = page.frameLocator('iframe');
  await expect.poll(() => page.locator('iframe').evaluate(el => el.clientHeight)).toBeGreaterThan(640);
  const height = await page.locator('iframe').evaluate(el => el.clientHeight);
  await frame.getByRole('heading', { name: 'Complete report' }).click();
  await expect(frame.getByRole('navigation', { name: 'Selected element hierarchy' })).toBeVisible();
  // Exercise a parent measurement handshake after the inspector exists.
  const reports = Number(await page.locator('body').getAttribute('data-layouts'));
  await page.locator('iframe').evaluate(el => (el as HTMLIFrameElement).contentWindow!.postMessage({ __nlHtmlCommand: 'paginate' }, '*'));
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-layouts'))).toBeGreaterThan(reports);
  await expect(page.locator('body')).toHaveAttribute('data-fallback', '');
  await expect.poll(() => page.locator('iframe').evaluate(el => el.clientHeight)).toBe(height);
  expect(await frame.getByText('Final passage', { exact: true }).evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.bottom <= innerHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1;
  })).toBe(true);
  await page.screenshot({ path: 'test-results/html-report-after-inspection.png', fullPage: true });
});

test('vertical HTML scroll boundaries stay inside the report while pinch reaches Canvas', async ({ page }) => {
  await page.setContent('<iframe sandbox="allow-scripts" style="width:880px;height:640px"></iframe>');
  await page.evaluate(() => {
    document.body.dataset.wheels = '0';
    window.addEventListener('message', e => {
      if (e.data?.type === 'wheel') document.body.dataset.wheels = String(Number(document.body.dataset.wheels) + 1);
    });
  });
  await page.locator('iframe').evaluate((el, source) => { (el as HTMLIFrameElement).srcdoc = source; }, withSelectionBridge('<body><p>Report scroll target</p>' + '<p>More content</p>'.repeat(90) + '</body>'));
  const target = page.frameLocator('iframe').getByText('Report scroll target');
  await expect(target).toBeVisible();
  const results = await target.evaluate(el => {
    const root = document.scrollingElement!;
    const wheel = (dy: number, ctrlKey = false) => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: dy, ctrlKey });
      el.dispatchEvent(e); return e.defaultPrevented;
    };
    root.scrollTop = 0;
    const topConsumed = wheel(-80);
    root.scrollTop = root.scrollHeight;
    const bottomConsumed = wheel(80);
    root.scrollTop = 0;
    const insideConsumed = wheel(80);
    return { topConsumed, bottomConsumed, insideConsumed };
  });
  expect(results).toEqual({ topConsumed: true, bottomConsumed: true, insideConsumed: false });
  await expect(page.locator('body')).toHaveAttribute('data-wheels', '0');
  await target.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -30, ctrlKey: true })));
  await expect(page.locator('body')).toHaveAttribute('data-wheels', '1');
});
