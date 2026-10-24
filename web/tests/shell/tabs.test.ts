import { parseTabs, serializeTabs } from '../../src/state/tabs';

describe('nl_tabs_v1', () => {
  it('round-trips and never saves the blank tab', () => {
    const raw = serializeTabs([{ id: 'doc-main' }, { id: 'blank' }, { id: 'notes' }], 'notes');
    expect(JSON.parse(raw)).toEqual({ tabs: [{ id: 'doc-main' }, { id: 'notes' }], active: 'notes' });
  });

  it('parses a payload exactly as legacy wrote it', () => {
    const legacy = '{"tabs":[{"id":"doc-main"},{"id":"chat-17"},{"id":"note:abc"}],"active":"chat-17"}';
    expect(parseTabs(legacy, new Set())).toEqual({
      tabs: [{ id: 'doc-main' }, { id: 'chat-17' }, { id: 'note:abc' }], active: 'chat-17',
    });
  });

  it('drops only explicitly-deleted threads, not ones merely absent from threads', () => {
    const raw = '{"tabs":[{"id":"chat-1"},{"id":"chat-2"},{"id":"notes"}],"active":"chat-1"}';
    expect(parseTabs(raw, new Set(['chat-1'])).tabs.map(t => t.id)).toEqual(['chat-2', 'notes']);
  });

  it('keeps singleton and note tabs even if their id is in the deleted set', () => {
    const raw = '{"tabs":[{"id":"notes"},{"id":"note:x"}],"active":null}';
    expect(parseTabs(raw, new Set(['notes', 'note:x'])).tabs).toHaveLength(2);
  });

  it.each([[null], [''], ['{'], ['null'], ['{"tabs":"no"}'], ['[]']])('survives garbage %j', raw => {
    expect(parseTabs(raw, new Set())).toEqual({ tabs: [], active: null });
  });

  it('ignores malformed tab entries', () => {
    expect(parseTabs('{"tabs":[null,{"id":3},{"id":"ok"},"str"],"active":5}', new Set())).toEqual({ tabs: [{ id: 'ok' }], active: null });
  });
});
