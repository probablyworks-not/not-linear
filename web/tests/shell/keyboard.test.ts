import { ESC_PRIORITY, handleEscape, registerEscLayer } from '../../src/lib/keyboard';

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
