import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface EdgeReveal {
  /** False when the user turned hiding off: the bar then stays in the page flow as before. */
  autohide: boolean;
  /** Whether the bar should be showing: the pointer is near its edge, or it is pinned. */
  visible: boolean;
  /** Spread on the bar so keyboard focus inside keeps it open. */
  focusProps: { onFocus(): void; onBlur(e: React.FocusEvent): void };
}

/** Pointer within this many px of the window edge brings the bar in. */
const TRIGGER_PX = 36;
/** Extra reach once shown, so the bar does not drop the moment the pointer drifts off it. */
const SLACK_PX = 24;
const HIDE_DELAY_MS = 220;
/** Set to '0' in localStorage to keep the bars always showing (also what the e2e suite does). */
export const AUTOHIDE_KEY = 'nl_autohide_bars';

function autohideEnabled(): boolean {
  try { return localStorage.getItem(AUTOHIDE_KEY) !== '0'; } catch { return true; }
}

/**
 * A bar that stays out of the way until the pointer goes to the top or bottom edge.
 * `pinned` forces it open (a draft in progress, an empty chat that needs its input).
 */
export function useEdgeReveal(ref: RefObject<HTMLElement>, edge: 'top' | 'bottom', pinned = false): EdgeReveal {
  const [autohide] = useState(autohideEnabled);
  const [near, setNear] = useState(false);
  const [focused, setFocused] = useState(false);
  const hideTimer = useRef<number>();

  // Syncing with the pointer, an external system.
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const dist = edge === 'top' ? e.clientY : window.innerHeight - e.clientY;
      const reach = (ref.current?.offsetHeight ?? 0) + SLACK_PX;
      const inside = ref.current?.contains(e.target as Node) ?? false;
      const want = dist <= TRIGGER_PX || inside || (dist <= reach && ref.current?.dataset.shown === 'true');
      window.clearTimeout(hideTimer.current);
      if (want) setNear(true);
      else hideTimer.current = window.setTimeout(() => setNear(false), HIDE_DELAY_MS);
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => { document.removeEventListener('mousemove', onMove); window.clearTimeout(hideTimer.current); };
  }, [ref, edge]);

  const focusProps = {
    onFocus: useCallback(() => setFocused(true), []),
    onBlur: useCallback((e: React.FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    }, []),
  };

  return { autohide, visible: !autohide || pinned || near || focused, focusProps };
}
