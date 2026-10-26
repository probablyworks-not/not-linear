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
