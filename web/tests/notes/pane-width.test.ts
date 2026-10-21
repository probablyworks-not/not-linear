import { describe, expect, it } from 'vitest';
import { PANE_DEFAULT, PANE_MIN, clampPaneWidth, paneLayout } from '../../src/notes/pane-width';

describe('note pane width', () => {
  it('never goes below the minimum or leaves the chat under 360px', () => {
    expect(clampPaneWidth(10, 1400)).toBe(PANE_MIN);
    expect(clampPaneWidth(5000, 1400)).toBe(1040);
    expect(clampPaneWidth(600, 1400)).toBe(600);
  });

  it('falls back to the default for nonsense', () => {
    expect(clampPaneWidth(Number.NaN, 1400)).toBe(PANE_DEFAULT);
  });

  it('sits beside the chat on a wide window and covers it on a narrow one', () => {
    expect(paneLayout(560, 1200)).toEqual({ width: 560, beside: true });
    expect(paneLayout(560, 800)).toEqual({ width: 800, beside: false });
  });

  it('shrinks a saved width when the window gets smaller', () => {
    expect(paneLayout(900, 1000).width).toBe(640);
  });
});
