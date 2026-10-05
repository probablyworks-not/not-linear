import { useState } from 'react';
import { aiContentHTML } from './stream-html';
import { WorkingStatus } from './WorkingStatus';
import { phaseFromStatus, statusDetail } from './status-copy';
import type { LiveTurn } from './chat-store';

/**
 * The assistant bubble while it is being written. Status and reasoning are React here (so the
 * reasoning panel keeps its open/closed state as text streams in); the answer is the same
 * rendered markdown legacy shows, which is what ends up in `stream` once the reply is saved.
 *
 * Two status shapes, as in legacy: before anything is known, the big working indicator where the
 * answer will go; once a tool is running, a small one above it that names what it is doing.
 */
export function LiveAiTurn({ turn }: { turn: LiveTurn }) {
  const [open, setOpen] = useState(false);
  const answering = turn.text.length > 0;
  return (
    <div className="msg ai" data-testid="live-ai-turn" data-live>
      {turn.status && !answering && (
        <div className="ai-status" data-label={turn.status}>
          <WorkingStatus compact phase={phaseFromStatus(turn.status)} detail={statusDetail(turn.status)} />
        </div>
      )}
      {turn.thinking && (
        <div className={`ai-thinking active${open ? ' open' : ''}`}>
          <button type="button" className="thinking-toggle" onClick={() => setOpen(o => !o)}>
            {!answering && <span className="thinking-live-spinner" />}
            <span className="thinking-label">{answering ? 'View reasoning' : 'Reasoning…'}</span>
          </button>
          <div className="thinking-body">{turn.thinking}</div>
        </div>
      )}
      {answering
        ? <div className="ai-content" dangerouslySetInnerHTML={{ __html: aiContentHTML({ text: turn.text, thinking: '' }) }} />
        : <div className="ai-content">{!turn.status && <WorkingStatus phase="thinking" />}</div>}
    </div>
  );
}
