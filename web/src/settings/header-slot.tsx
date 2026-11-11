import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The Settings header has a slot for the current tab's page actions (Import, New skill, ...).
// A tab renders <HeaderActions> and its children appear there without the page knowing about them.
export const HeaderSlot = createContext<HTMLElement | null>(null);

export function HeaderActions({ children }: { children: ReactNode }) {
  const el = useContext(HeaderSlot);
  return el ? createPortal(children, el) : null;
}

// Full-page detail views (a skill) cover the content area but must not scroll away with the list
// behind them, so they render into a sibling of the scroller rather than inside it.
export const OverlaySlot = createContext<HTMLElement | null>(null);

export function DetailOverlay({ children }: { children: ReactNode }) {
  const el = useContext(OverlaySlot);
  return el ? createPortal(children, el) : null;
}
