# C0 spike — archived harness

The throwaway harness that decided the Canvas renderer (ADR-067). **Not application code.** It was
removed from `web/src` after the measurement so nothing ships; this copy exists so the result can be
reproduced rather than taken on trust.

## Honest provenance

- `spike-drive.mjs` — the real driver script, recovered from the session's working directory and
  patched to the final version that produced `results-final-run.txt`.
- `results-run1-before-fixes.txt` — the genuine first run. It is the interesting one: it is what
  exposed the three defects listed below.
- `results-final-run.txt` — the final run's measurements, transcribed from the session output.
- `screenshot-100pct.png` — the real harness at 100%, showing native text selection inside a card
  (REPLY 7), the scoped composer anchored under the selected card, a branch card placed beside its
  source, the minimap and the React Flow attribution badge.
- `harness/` — **reconstructed, not recovered.** The original `.tsx` files were deleted before they
  were copied here. These are rewritten from the same session's edits and have *not* been re-run.
  Treat them as a faithful description of what was measured, not as verified bytes: if you need the
  numbers again, run them and check they reproduce.

## To re-run

1. `cp harness/spike.html <repo>/web/spike.html`
2. `mkdir -p <repo>/web/src/canvas/__spike__ && cp harness/*.ts harness/*.tsx <repo>/web/src/canvas/__spike__/`
3. `cp spike-drive.mjs <repo>/web/`
4. `cd <repo>/web && pnpm dev --port 5199`, then in another shell `node spike-drive.mjs`
5. Delete all four copies afterwards. `@xyflow/react` is already a dependency.

## The three defects the spike exposed

1. **React Flow's stylesheet sets `user-select: none` on `.react-flow__node`.** Out of the box, text
   inside a card cannot be selected at all — which would have killed the entire branching gesture.
   The fix is one line (`user-select: text` on the card body), but it has to be deliberate, and it
   must be in the C3 acceptance criteria rather than discovered late.
2. **Undo must snapshot at gesture *start*.** Snapshotting when a resize reports `resizing: false`
   captures the already-resized geometry, so undo silently does nothing. Gate on a ref so the
   intermediate frames add no entries and the snapshot is taken on the first `resizing: true`.
3. **A resize handle can leave the viewport on a large card at high zoom.** At 200% a 660x480
   logical card is 1320x960 on screen, putting its bottom-right handle off-screen — the drag then
   silently does nothing. Zoom-correct maths is not sufficient; the handle has to stay reachable,
   which is a real C3 interaction requirement (and a keyboard path is the fallback).
