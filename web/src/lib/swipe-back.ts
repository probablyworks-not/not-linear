// macOS two-finger swipe right = back. The trackpad arrives as wheel events with a horizontal
// delta, and inertia keeps them coming after the fingers lift, so one swipe is one *gesture*:
// events less than GESTURE_GAP_MS apart. It fires once per gesture, when the horizontal travel
// crosses the threshold and clearly dominates the vertical.
const THRESHOLD = 80;
const GESTURE_GAP_MS = 180;
/** Surfaces that use horizontal wheel input themselves (canvas panning, text inputs). */
const OWN_HORIZONTAL = '.react-flow, input, textarea, [data-no-swipe-back]';

type DirectionAware = WheelEvent & { webkitDirectionInvertedFromDevice?: boolean };

function canScrollLeft(el: Element | null): boolean {
  for (; el && el !== document.documentElement; el = el.parentElement) {
    if (el.scrollLeft > 0 && el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== 'hidden') return true;
  }
  return false;
}

/** Installs the wheel listener. Returns its teardown. */
export function installSwipeBack(onBack: () => void): () => void {
  let travel = 0;
  let lastAt = 0;
  let fired = false;
  let blocked = false;

  const onWheel = (e: WheelEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    if (e.timeStamp - lastAt > GESTURE_GAP_MS) {
      travel = 0; fired = false;
      blocked = !!target && (!!target.closest(OWN_HORIZONTAL) || canScrollLeft(target));
    }
    lastAt = e.timeStamp;
    if (fired || blocked || e.ctrlKey) return; // ctrlKey is a pinch-zoom
    // Normalise "natural scrolling" off, so fingers moving right is always positive travel.
    const natural = (e as DirectionAware).webkitDirectionInvertedFromDevice !== false;
    const dx = natural ? -e.deltaX : e.deltaX;
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) { travel = 0; return; }
    travel += dx;
    if (travel > THRESHOLD) { fired = true; onBack(); }
  };

  window.addEventListener('wheel', onWheel, { passive: true });
  return () => window.removeEventListener('wheel', onWheel);
}
