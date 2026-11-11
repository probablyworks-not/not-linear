import { describe, expect, it } from 'vitest';
import { withSelectionBridge } from '../../src/canvas/view/html-bridge';

// The bridge script is the only way a selection or a real content height ever leaves the
// sandboxed iframe (no allow-same-origin, so no shared DOM/selection with the parent) — these
// lock in that it actually lands in the document, in both the well-formed and malformed case.

describe('withSelectionBridge', () => {
  it('inserts the bridge script right before </body> when present', () => {
    const out = withSelectionBridge('<html><body><p>hi</p></body></html>');
    expect(out.indexOf('__nlHtmlPart')).toBeGreaterThan(0);
    expect(out.indexOf('__nlHtmlPart')).toBeLessThan(out.indexOf('</body>'));
  });

  it('appends the bridge script at the end when the model wrote no </body>', () => {
    const out = withSelectionBridge('<div>no doctype, no body tag</div>');
    expect(out.startsWith('<div>no doctype, no body tag</div>')).toBe(true);
    expect(out).toContain('__nlHtmlPart');
  });

  it('is case-insensitive about </BODY>', () => {
    const out = withSelectionBridge('<HTML><BODY>x</BODY></HTML>');
    expect(out.indexOf('__nlHtmlPart')).toBeLessThan(out.indexOf('</HTML>'));
  });
});

describe('HTML horizontal wheel ownership', () => {
  it('scrolls the HTML region and never forwards its horizontal boundary gesture', () => {
    const out = withSelectionBridge('<body></body>');
    const source = out.match(/<script>\(function\(\)\{\nfunction post[\s\S]*?<\/script>/)![0];
    const scroller = document.createElement('div');
    scroller.style.overflowX = 'auto';
    Object.defineProperties(scroller, { scrollWidth: { value: 900 }, clientWidth: { value: 300 } });
    document.body.append(scroller);
    const messages: unknown[] = [];
    const original = window.postMessage;
    window.postMessage = ((message: unknown) => { messages.push(message); }) as typeof window.postMessage;
    window.eval(source.replace(/^<script>|<\/script>$/g, ''));
    try {
      const wheel = (dx: number, ctrlKey = false) => {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: dx, ctrlKey });
        scroller.dispatchEvent(event);
        return event;
      };
      expect(wheel(80).defaultPrevented).toBe(true);
      expect(scroller.scrollLeft).toBe(80);
      scroller.scrollLeft = 600;
      wheel(80);
      expect(messages.filter((m: any) => m.type === 'wheel')).toHaveLength(0);
      wheel(80, true);
      expect(messages.filter((m: any) => m.type === 'wheel')).toHaveLength(1);
    } finally {
      window.postMessage = original;
      scroller.remove();
    }
  });
});
