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
  // The capture preview wins over everything: legacy handles its Escape in the capture phase.
  // Legacy closes the image preview on its own Escape listener, ahead of the ladder; it sits just under the capture preview.
  imagePreview: 160,
  // A previewed html/svg file sits with the image preview: both are "a thing from a reply, full size".
  filePreview: 159,
  // The icon picker closes on its own Escape in legacy, before anything else on the page.
  glyphPicker: 165,
  branchCanvas: 150,
  // Canvas (C2+). The workspace itself is a tab and dismisses nothing; these are the surfaces that
  // open over it. The scoped composer sits just above the selection popover because Escape should
  // drop the composer before clearing the selection it is attached to.
  canvasOutputDetail: 144,
  canvasLibrary: 142,
  canvasComposer: 12,
  storyPlayer: 140,
  searchPalette: 130,
  confirm: 120,
  shortcutsSheet: 115,
  modesModal: 110,
  skillsModal: 111,
  // Settings is a full page, so it sits above the sidebar behind it; its skill detail closes first.
  settingsDetail: 108,
  settingsPage: 106,
  projectPanel: 100,
  projectsView: 90,
  sidebar: 80,
  ctxRankingPopover: 70,
  // The clarifying-questions card is inline, so every dialog and menu outranks it; Esc skips it.
  clarifyCard: 55,
  modelMenu: 60,
  modeMenu: 50,
  branchMenu: 48,
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

export interface GlobalKeyHandlers {
  newChat(): void;
  toggleSearch(): void;
  branchSelection(): void;
  copyLastReply(): void;
  retryLastReply(): void;
  toggleShortcuts(): void;
}

/** Installs the single global keydown listener. Returns its teardown. */
export function installGlobalKeys(handlers: GlobalKeyHandlers): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { handleEscape(); return; }
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const run = (fn: () => void): void => { e.preventDefault(); fn(); };
    if (e.shiftKey) {
      if (key === 'b') run(handlers.branchSelection);
      else if (key === 'c') run(handlers.copyLastReply);
      else if (key === 'r') run(handlers.retryLastReply);
    } else if (key === 'k') run(handlers.toggleSearch);
    else if (key === 'n') run(handlers.newChat);
    else if (key === '/') run(handlers.toggleShortcuts);
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
