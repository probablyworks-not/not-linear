import { MessageCircleQuestion } from 'lucide-react';
import type { ClarifyAnswer } from './clarify';

/** What the user said when asked to clarify, kept as quiet chips above the reply it shaped. */
export function ClarifySummary({ answers }: { answers: readonly ClarifyAnswer[] }) {
  const given = answers.filter(a => a.answer.trim());
  if (!given.length) return null;
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-1.5" data-testid="clarify-summary">
      <MessageCircleQuestion size={14} className="text-text-3" aria-hidden />
      {given.map(a => (
        <span key={a.id} title={a.question} className="rounded border border-rule-2 px-1.5 py-0.5 text-xs text-text-2">{a.answer}</span>
      ))}
    </div>
  );
}
