import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { pickStatusWord, type StatusPhase } from './status-copy';

/**
 * The orbiting dot and a word that changes every couple of seconds (app.js startWorkingStatus).
 * `compact` is the small italic form used in the status line above a reply. A new word is picked
 * after 2.2-3.6s, never the same one twice in a row.
 */
export function WorkingStatus({ phase, detail = '', compact = false }: { phase: StatusPhase; detail?: string; compact?: boolean }) {
  const [word, setWord] = useState(() => pickStatusWord(phase, undefined));
  const last = useRef(word);

  // A timer is an external system; re-pick at once when the phase changes, then on a jittered interval.
  useEffect(() => {
    let timer = 0;
    const tick = (): void => {
      const next = pickStatusWord(phase, last.current);
      last.current = next;
      setWord(next);
      timer = window.setTimeout(tick, 2200 + Math.floor(Math.random() * 1400));
    };
    timer = window.setTimeout(tick, 2200 + Math.floor(Math.random() * 1400));
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <span className={clsx('working-status', compact && 'compact')} aria-live="polite">
      <span className="working-orbit" aria-hidden="true" />
      <span className="working-copy">
        <span className="working-text">{word}</span>
        {detail && <span className="working-detail">{detail}</span>}
      </span>
    </span>
  );
}
