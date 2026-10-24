import { describe, expect, it } from 'vitest';
import {
  CANVAS_TAB_PREFIX, canvasIdOfTab, canvasTabId, isCanvasTabId, isNoteTabId, isSingletonTab,
  parseTabs, serializeTabs,
} from '../../src/state/tabs';
import { viewForTab } from '../../src/shell/TabStrip';

// Canvas tabs carry their own identity rather than sharing one singleton, which is the shape
// Notes' `notes` tab got wrong (bugs #042/#043: open A → open B → back to A → reload). The
// `nl_tabs_v1` envelope is a compatibility contract with the legacy app, so a canvas tab has to
// ride inside it without changing its shape.

describe('canvas tab identity', () => {
  it('is per canvas, not a singleton', () => {
    expect(canvasTabId('cv_a')).toBe('canvas:cv_a');
    expect(canvasTabId('cv_a')).not.toBe(canvasTabId('cv_b'));
    expect(isSingletonTab('canvas:cv_a')).toBe(false);
  });

  it('round-trips the id', () => {
    expect(canvasIdOfTab(canvasTabId('cv_x9'))).toBe('cv_x9');
    expect(CANVAS_TAB_PREFIX).toBe('canvas:');
  });

  it('is not mistaken for a note tab, nor a note for a canvas', () => {
    expect(isCanvasTabId('canvas:cv_1')).toBe(true);
    expect(isCanvasTabId('note:n1')).toBe(false);
    expect(isNoteTabId('canvas:cv_1')).toBe(false);
  });

  it('routes to the canvas view, and leaves every other tab where it was', () => {
    expect(viewForTab('canvas:cv_1')).toBe('canvas');
    expect(viewForTab('note:n1')).toBe('notes');
    expect(viewForTab('notes')).toBe('notes');
    expect(viewForTab('blank')).toBe('blank');
    expect(viewForTab('chat-17')).toBe('chat');
    expect(viewForTab('doc-main')).toBe('chat');
  });
});

describe('canvas tabs in the nl_tabs_v1 envelope', () => {
  it('serialises in the legacy shape, alongside chats and notes', () => {
    const raw = serializeTabs([{ id: 'doc-main' }, { id: 'canvas:cv_1' }, { id: 'note:n1' }, { id: 'blank' }], 'canvas:cv_1');
    expect(JSON.parse(raw)).toEqual({
      tabs: [{ id: 'doc-main' }, { id: 'canvas:cv_1' }, { id: 'note:n1' }],
      active: 'canvas:cv_1',
    });
  });

  it('survives a reload with several canvases open, each keeping its own identity', () => {
    const raw = serializeTabs([{ id: 'canvas:cv_a' }, { id: 'canvas:cv_b' }, { id: 'chat-1' }], 'canvas:cv_b');
    const parsed = parseTabs(raw, new Set());
    expect(parsed.tabs.map(t => t.id)).toEqual(['canvas:cv_a', 'canvas:cv_b', 'chat-1']);
    expect(parsed.active).toBe('canvas:cv_b');
  });

  it('is kept when a *thread* of the same id was deleted: the namespaces do not collide', () => {
    const raw = '{"tabs":[{"id":"canvas:cv_1"},{"id":"chat-1"}],"active":"canvas:cv_1"}';
    expect(parseTabs(raw, new Set(['canvas:cv_1', 'chat-1'])).tabs.map(t => t.id)).toEqual(['canvas:cv_1']);
  });

  it('a legacy payload that has never seen a canvas still parses unchanged', () => {
    const legacy = '{"tabs":[{"id":"doc-main"},{"id":"chat-17"},{"id":"note:abc"}],"active":"chat-17"}';
    expect(parseTabs(legacy, new Set())).toEqual({
      tabs: [{ id: 'doc-main' }, { id: 'chat-17' }, { id: 'note:abc' }], active: 'chat-17',
    });
  });
});
