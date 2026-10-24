import { beforeAll, describe, expect, it } from 'vitest';
import { readCanvasSelection } from '../../src/canvas/view/useCanvasSelection';

// jsdom implements Range but not its layout methods. The rect only decides where the popover is
// drawn, so a fixed one is enough here; placement itself is a browser concern.
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 10, y: 20, width: 100, height: 18, top: 20, left: 10, right: 110, bottom: 38, toJSON: () => ({}) }) as DOMRect;
});

// Turning a DOM selection into an anchor. The offset is taken against the *part's* text, not the
// rendered DOM, because the part text is what gets frozen and what the anchor resolves against
// later — rendered markup has tags and whitespace the source does not.

function selectWithin(html: string, pick: (root: HTMLElement) => { node: Node; start: number; end: number }): void {
  document.body.innerHTML = html;
  const root = document.body.firstElementChild as HTMLElement;
  const { node, start, end } = pick(root);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

const TEXT = 'alpha beta gamma delta';
const HTML = `<div data-message="ms_1"><div data-part="pt_1">${TEXT}</div></div>`;
const lookup = (id: string): string | null => (id === 'pt_1' ? TEXT : null);

describe('reading a canvas selection', () => {
  it('finds the message, the part and the offset of the quote', () => {
    selectWithin(HTML, root => ({ node: root.querySelector('[data-part]')!.firstChild!, start: 6, end: 16 }));
    const s = readCanvasSelection(lookup);
    expect(s).toMatchObject({ messageId: 'ms_1', partId: 'pt_1', quote: 'beta gamma', start: 6 });
  });

  it('is null when nothing is selected', () => {
    document.body.innerHTML = HTML;
    window.getSelection()!.removeAllRanges();
    expect(readCanvasSelection(lookup)).toBeNull();
  });

  it('is null for a selection outside any part', () => {
    selectWithin('<div><p>loose text with no part</p></div>', root => ({ node: root.querySelector('p')!.firstChild!, start: 0, end: 5 }));
    expect(readCanvasSelection(lookup)).toBeNull();
  });

  it('reports start -1 when the quote cannot be located in the part text', () => {
    // The rendered DOM says one thing, the part text another: refuse to guess an offset.
    selectWithin(HTML, root => ({ node: root.querySelector('[data-part]')!.firstChild!, start: 0, end: 5 }));
    const s = readCanvasSelection(() => 'completely different source text');
    expect(s?.start).toBe(-1);
  });

  it('walks up from a nested element to find the part', () => {
    selectWithin(
      '<div data-message="ms_2"><div data-part="pt_1"><p><em>alpha beta gamma delta</em></p></div></div>',
      root => ({ node: root.querySelector('em')!.firstChild!, start: 6, end: 10 }),
    );
    expect(readCanvasSelection(lookup)).toMatchObject({ messageId: 'ms_2', partId: 'pt_1', quote: 'beta', start: 6 });
  });
});
