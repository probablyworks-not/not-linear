// How wide the note pane beside a chat may be. Pure so the rules are tested without a browser.

export const PANE_MIN = 340;
export const PANE_DEFAULT = 560;
/** Below this viewport width there is no room to sit beside the chat, so the pane covers it. */
export const PANE_OVERLAY_BELOW = 900;
/** The chat column never gets squeezed below this while the pane is beside it. */
const CHAT_MIN = 360;
/** Mirrors --sidebar-w in tokens.css. */
export const SIDEBAR_PX = 264;
export const PANE_STORAGE_KEY = 'nl_note_pane_w';

/** Keeps a requested width between the minimum and what leaves the chat readable. */
export function clampPaneWidth(width: number, viewport: number, reserved = 0): number {
  // `reserved` is width already spoken for on the left (the open sidebar).
  const max = Math.max(PANE_MIN, viewport - reserved - CHAT_MIN);
  const w = Number.isFinite(width) ? width : PANE_DEFAULT;
  return Math.round(Math.min(max, Math.max(PANE_MIN, w)));
}

/** The width actually drawn, and whether the chat column makes room for it (otherwise it overlays). */
export function paneLayout(width: number, viewport: number, reserved = 0): { width: number; beside: boolean } {
  if (viewport < PANE_OVERLAY_BELOW) return { width: viewport, beside: false };
  return { width: clampPaneWidth(width, viewport, reserved), beside: true };
}

export function readPaneWidth(): number {
  try {
    const n = Number(localStorage.getItem(PANE_STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? n : PANE_DEFAULT;
  } catch { return PANE_DEFAULT; }
}

export function writePaneWidth(width: number): void {
  try { localStorage.setItem(PANE_STORAGE_KEY, String(Math.round(width))); } catch { /* a width is a convenience */ }
}
