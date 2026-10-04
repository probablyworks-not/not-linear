import { useEffect } from 'react';

// The Escape chain, ported from app.js:6252. Legacy is a 15-deep `if` ladder
// that reads each surface's open state off a DOM class. The precedence is the
// behaviour — Esc on a confirm dialog that opened over the search palette must
// close the dialog, not the palette — so it is kept as an explicit ordered
// table instead, where adding a surface is one line and the order is reviewable.
//
// Higher number wins. The gaps are deliberate headroom. Surfaces not built yet
// (P4-P5) are listed so their slot is fixed now rather than negotiated later.
export const ESC_PRIORITY = {
  branchCanvas: 150,
  storyPlayer: 140,
  searchPalette: 130,
  confirm: 120,
  modesModal: 110,
  projectPanel: 100,
  projectsView: 90,
  sidebar: 80,
  ctxRankingPopover: 70,
  modelMenu: 60,
  modeMenu: 50,
  attachMenu: 45,
  ctxPanel: 40,
  prefs: 30,
  selectionPopover: 10,
} as const;

export interface EscLayer {
  id: string;
  priority: number;
  isOpen(): boolean;
  close(): void;
}

const layers = new Map<string, EscLayer>();

export function registerEscLayer(layer: EscLayer): () => void {
  layers.set(layer.id, layer);
  return () => { if (layers.get(layer.id) === layer) layers.delete(layer.id); };
}

/** Closes the highest-priority open layer. Returns whether one was closed. */
export function handleEscape(): boolean {
  const open = [...layers.values()]
    .filter(l => l.isOpen())
    .sort((a, b) => b.priority - a.priority)[0];
  if (!open) return false;
  open.close();
  return true;
}

/** Installs the single global keydown listener. Returns its teardown. */
export function installGlobalKeys(handlers: { newChat(): void; toggleSearch(): void }): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      handleEscape();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      handlers.toggleSearch();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      handlers.newChat();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/**
 * Registers a surface in the Esc chain only while it is open. Registering on
 * open (rather than always, with an isOpen probe) means the table can never
 * hold a stale closure over a previous render's state.
 */
export function useEscLayer(id: string, priority: number, isOpen: boolean, close: () => void): void {
  useEffect(() => {
    if (!isOpen) return undefined;
    return registerEscLayer({ id, priority, isOpen: () => true, close });
  }, [id, priority, isOpen, close]);
}
