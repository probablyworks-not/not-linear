import { ESC_PRIORITY, handleEscape, installGlobalKeys, registerEscLayer } from '../../src/lib/keyboard';

describe('Esc chain', () => {
  it('closes only the highest-priority open layer, then the next', () => {
    const closed: string[] = [];
    let confirmOpen = true;
    let sidebarOpen = true;
    const offs = [
      registerEscLayer({ id: 'sidebar', priority: ESC_PRIORITY.sidebar, isOpen: () => sidebarOpen, close: () => { sidebarOpen = false; closed.push('sidebar'); } }),
      registerEscLayer({ id: 'confirm', priority: ESC_PRIORITY.confirm, isOpen: () => confirmOpen, close: () => { confirmOpen = false; closed.push('confirm'); } }),
    ];
    expect(handleEscape()).toBe(true);
    expect(closed).toEqual(['confirm']);
    expect(handleEscape()).toBe(true);
    expect(closed).toEqual(['confirm', 'sidebar']);
    expect(handleEscape()).toBe(false);
    offs.forEach(off => off());
  });

  it('keeps legacy precedence: preview > confirm > popover > panel', () => {
    const p = ESC_PRIORITY;
    expect(p.branchCanvas).toBeGreaterThan(p.searchPalette);
    expect(p.searchPalette).toBeGreaterThan(p.confirm);
    expect(p.confirm).toBeGreaterThan(p.modesModal);
    expect(p.modesModal).toBeGreaterThan(p.sidebar);
    expect(p.sidebar).toBeGreaterThan(p.ctxRankingPopover);
    expect(p.ctxPanel).toBeGreaterThan(p.prefs);
    expect(p.prefs).toBeGreaterThan(p.selectionPopover);
  });
});

describe('global shortcuts', () => {
  const press = (key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
    document.dispatchEvent(e);
    return e;
  };

  it('routes each binding to one handler and claims the event', () => {
    const calls: string[] = [];
    const off = installGlobalKeys({
      newChat: () => calls.push('new'), toggleSearch: () => calls.push('search'),
      branchSelection: () => calls.push('branch'), copyLastReply: () => calls.push('copy'),
      retryLastReply: () => calls.push('retry'), toggleShortcuts: () => calls.push('sheet'),
    });
    const claimed = [
      press('n', { metaKey: true }), press('k', { metaKey: true }), press('/', { metaKey: true }),
      press('B', { metaKey: true, shiftKey: true }),
      press('C', { metaKey: true, shiftKey: true }), press('R', { metaKey: true, shiftKey: true }),
    ];
    expect(calls).toEqual(['new', 'search', 'sheet', 'branch', 'copy', 'retry']);
    expect(claimed.every(e => e.defaultPrevented)).toBe(true);
    off();
  });

  it('leaves undo, redo and unbound combos alone', () => {
    const calls: string[] = [];
    const noop = (): void => { calls.push('x'); };
    const off = installGlobalKeys({
      newChat: noop, toggleSearch: noop, branchSelection: noop,
      copyLastReply: noop, retryLastReply: noop, toggleShortcuts: noop,
    });
    const untouched = [
      press('z', { metaKey: true }), press('z', { metaKey: true, shiftKey: true }), press('y', { metaKey: true }),
      press('b', {}), press('B', { shiftKey: true }), press('c', { metaKey: true }), press('n', { metaKey: true, altKey: true }),
    ];
    expect(calls).toEqual([]);
    expect(untouched.some(e => e.defaultPrevented)).toBe(false);
    off();
  });
});
