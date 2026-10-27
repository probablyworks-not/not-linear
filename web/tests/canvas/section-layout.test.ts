import { describe, it, expect, afterEach } from 'vitest';
import { makeRoomForReport } from '../../src/canvas/view/section-layout';
import { liveText } from '../../src/canvas/view/live-text';
import type { LayoutEntry } from '../../src/canvas/types';
const entry = (entityId: string, x: number, y: number, h = 100): LayoutEntry => ({ entityId, x, y, w: 880, h });
afterEach(() => liveText.clearAll());
describe('stacked report layout', () => {
  it('moves overlapping cards below an expanded report and cascades without moving side branches', () => {
    const entries = { report: entry('report', 0, 0, 2000), below: entry('below', 0, 600), last: entry('last', 0, 850), side: entry('side', 1000, 600) };
    makeRoomForReport(entries, 'report');
    expect(entries.below.y).toBe(2024);
    expect(entries.last.y).toBe(2148);
    expect(entries.side.y).toBe(600);
    const settled = structuredClone(entries);
    makeRoomForReport(entries, 'report');
    expect(entries).toEqual(settled);
  });
  it('leaves cards above the report and hidden cards unchanged', () => {
    const entries = { report: entry('report', 0, 200, 2000), above: entry('above', 0, 0), hidden: { ...entry('hidden', 0, 600), hidden: true } };
    makeRoomForReport(entries, 'report');
    expect(entries.above.y).toBe(0); expect(entries.hidden.y).toBe(600);
  });
});
describe('HTML streaming cache', () => {
  it('clears HTML and text for the completed message without affecting another stream', () => {
    liveText.set('a', 'working'); liveText.setHtml('a', '<p>first</p>'); liveText.setHtml('b', '<p>other</p>');
    liveText.clear('a');
    expect(liveText.getOf('a')()).toBeUndefined(); expect(liveText.getHtmlOf('a')()).toBeUndefined();
    expect(liveText.getHtmlOf('b')()).toBe('<p>other</p>');
  });
  it('notifies and removes HTML-only streams on clearAll', () => {
    let notices = 0; const unsub = liveText.subscribeTo('a')(() => notices++);
    liveText.setHtml('a', '<p>partial</p>'); liveText.clearAll();
    expect(notices).toBe(2); expect(liveText.getHtmlOf('a')()).toBeUndefined(); unsub();
  });
});
