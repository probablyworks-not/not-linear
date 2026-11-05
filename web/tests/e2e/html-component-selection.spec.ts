import { test, expect } from '@playwright/test';
import { withSelectionBridge } from '../../src/canvas/view/html-bridge';

test('Ask retains the entire inspected two-column component through native selection events', async ({ page }) => {
  await page.setContent('<iframe sandbox="allow-scripts" style="width:880px;height:640px"></iframe><button id="ask">Ask about this</button><output></output>');
  await page.evaluate(() => {
    let selected = '';
    window.addEventListener('message', e => {
      if (e.data?.type === 'selection') selected = e.data.text;
    });
    document.querySelector('button')!.addEventListener('mousedown', e => e.preventDefault());
    document.querySelector('button')!.addEventListener('click', () => { document.querySelector('output')!.textContent = selected; });
  });
  const html = '<body><section><h2>Migration risks</h2><div id="component" style="display:grid;grid-template-columns:1fr 1fr"><div><h3>Established from the repository</h3><ul><li id="detail">The backend is FastAPI.</li><li>Screening records use SQLite.</li></ul></div><div><h3>Implication</h3><ul><li>Cloud Run can host the application.</li><li>Decks must move to private object storage.</li></ul></div></div><p>Outside the component.</p></section></body>';
  await page.locator('iframe').evaluate((el, source) => { (el as HTMLIFrameElement).srcdoc = source; }, withSelectionBridge(html));
  const frame = page.frameLocator('iframe');
  await frame.locator('#detail').click();
  await frame.locator('#detail').dblclick();
  await expect.poll(() => frame.locator('#component').evaluate(el => el.style.outline)).not.toBe('');
  // A delayed browser selectionchange from double-click/focus must not replace the
  // blue-border component with one native text range or clear it on focus transfer.
  await frame.locator('#detail').evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    selection.removeAllRanges(); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Ask about this' }).click();
  await expect(page.locator('output')).toContainText('Established from the repository');
  await expect(page.locator('output')).toContainText('Decks must move to private object storage.');
  await expect(page.locator('output')).not.toContainText('Outside the component.');
  // A deliberate text drag still switches away from component inspection.
  await frame.locator('#detail').evaluate(el => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, clientX: 90, clientY: 10 }));
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Ask about this' }).click();
  await expect(page.locator('output')).toHaveText('The backend is FastAPI.');
  await expect(frame.getByRole('navigation', { name: 'Selected element hierarchy' })).toHaveCount(0);
});
