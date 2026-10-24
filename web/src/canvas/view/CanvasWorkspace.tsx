import { useEffect, useState } from 'react';
import { Frame } from 'lucide-react';
import { getCanvas } from '../canvas-repo';
import type { CanvasDoc } from '../types';

// C2: the tab exists, carries its own identity, and reopens to the right canvas. The spatial
// editor — pan, zoom, drag, resize, the Ink composer — is C3, and React Flow is not imported until
// then. What this proves now is the part C3 cannot: that `canvas:<id>` survives a reload with
// several tabs open, which is the regression Notes' singleton tab produced (bugs #042/#043).

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; doc: CanvasDoc } | { state: 'error'; message: string };

export function CanvasWorkspace({ canvasId }: { canvasId: string }) {
  // AppShell keys this component by tab id, so a different canvas is a fresh mount and the initial
  // state is already 'loading'. Resetting it here as well is the cascading render the lint rule is
  // about, so the effect only ever reports a result.
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    getCanvas(canvasId)
      .then(doc => { if (live) setLoad(doc ? { state: 'ready', doc } : { state: 'missing' }); })
      .catch((e: unknown) => { if (live) setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [canvasId]);

  if (load.state === 'loading') {
    return <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex-1 p-8 text-sm text-text-3">Loading canvas&hellip;</main>;
  }
  if (load.state === 'error') {
    return (
      <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex-1 p-8">
        <div role="alert" className="max-w-[460px] rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">
          This canvas could not be opened: {load.message}
        </div>
      </main>
    );
  }
  if (load.state === 'missing') {
    return (
      <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex-1 p-8">
        <div className="max-w-[460px] text-sm text-text-2">
          <div className="mb-1 text-base font-medium text-text">This canvas is gone</div>
          It was deleted, or it was never on this device. Close the tab to tidy up.
        </div>
      </main>
    );
  }

  const { doc } = load;
  return (
    <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex min-h-0 flex-1 flex-col bg-cv-ground">
      <header className="flex items-center gap-2.5 border-b border-cv-divider px-7 py-3">
        <Frame size={16} aria-hidden className="text-sec-canvas" />
        <h1 data-testid="canvas-title" className="m-0 truncate text-base font-medium text-text">{doc.summary.title}</h1>
        <span className="font-mono text-xs text-text-3">
          {doc.summary.counts.threads} thread{doc.summary.counts.threads === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <span data-testid="canvas-save-state" className="font-mono text-xs text-text-3">Saved</span>
      </header>
      <div className="grid flex-1 place-items-center p-8">
        <div className="max-w-[380px] text-center">
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-sec-canvas-soft text-sec-canvas"><Frame size={22} aria-hidden /></span>
          <div className="mb-1 text-base font-semibold text-text">Nothing on this canvas yet</div>
          <p className="m-0 text-xs leading-normal text-text-3">
            The workspace lands next: ask a question anywhere on the canvas, branch from any part of
            the answer, and bring the useful paths back together.
          </p>
        </div>
      </div>
    </main>
  );
}
