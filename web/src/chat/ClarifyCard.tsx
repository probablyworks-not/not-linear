import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronRight, MessageCircleQuestion } from 'lucide-react';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import type { ClarifyAnswer, ClarifyQuestion } from './clarify';

interface Pick { labels: string[]; other: string }

/** The answer text for one question: the chosen labels, then anything typed, joined. */
function answerOf(p: Pick | undefined): string {
  if (!p) return '';
  return [...p.labels, p.other.trim()].filter(Boolean).join(', ');
}

/**
 * Questions the model wants answered before it replies, one at a time. Options are chips (number
 * keys pick them), there is always an "Other" line, and nothing is mandatory: Next with no pick
 * leaves that question out, Skip drops them all.
 */
export function ClarifyCard({ questions, onSubmit, onSkip }: {
  questions: readonly ClarifyQuestion[];
  onSubmit(answers: ClarifyAnswer[]): void;
  onSkip(): void;
}) {
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const root = useRef<HTMLDivElement>(null);
  const q = questions[step]!;
  const last = step === questions.length - 1;
  const cur = picks[q.id];

  useEscLayer('clarify-card', ESC_PRIORITY.clarifyCard, true, onSkip);
  // Focus the card so the number keys work straight away. Syncing with the DOM focus, an external system.
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, [step]);

  const toggle = (label: string): void => {
    setPicks(prev => {
      const p = prev[q.id] ?? { labels: [], other: '' };
      const has = p.labels.includes(label);
      const labels = q.multi ? (has ? p.labels.filter(l => l !== label) : [...p.labels, label]) : (has ? [] : [label]);
      return { ...prev, [q.id]: { ...p, labels } };
    });
  };
  const setOther = (other: string): void => {
    setPicks(prev => {
      const p = prev[q.id] ?? { labels: [], other: '' };
      // A typed answer replaces a single choice, as it would on a form.
      return { ...prev, [q.id]: { labels: q.multi ? p.labels : [], other } };
    });
  };

  const finish = useCallback((): void => {
    onSubmit(questions.map(x => ({ id: x.id, question: x.question, answer: answerOf(picks[x.id]) })).filter(a => a.answer));
  }, [onSubmit, questions, picks]);
  const next = (): void => { if (last) finish(); else setStep(step + 1); };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(); return; }
    const typing = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Enter') { e.preventDefault(); next(); return; }
    if (typing) return;
    const n = Number(e.key);
    if (n >= 1 && n <= q.options.length) { e.preventDefault(); toggle(q.options[n - 1]!.label); }
  };

  return (
    <div
      ref={root} tabIndex={-1} onKeyDown={onKeyDown} data-testid="clarify-card" role="group" aria-label="Clarifying questions"
      className="animate-[fadein_160ms_ease-out] rounded-xl border border-rule bg-surface p-4 shadow-md outline-none"
    >
      <div className="mb-3 flex items-center gap-2 text-text-2">
        <MessageCircleQuestion size={14} aria-hidden />
        <span className="flex-1 text-sm">A few quick questions so I get this right</span>
        <span className="flex gap-1" aria-label={`Question ${step + 1} of ${questions.length}`}>
          {questions.map((x, i) => (
            <span key={x.id} className={clsx('h-1.5 w-1.5 rounded-full', i === step ? 'bg-text-2' : i < step ? 'bg-text-3' : 'bg-rule-2')} />
          ))}
        </span>
      </div>

      <p className="mb-2.5 text-base text-text" data-testid="clarify-question">{q.question}</p>
      <div className="flex flex-col gap-1.5" role={q.multi ? 'group' : 'radiogroup'}>
        {q.options.map((o, i) => {
          const on = !!cur?.labels.includes(o.label);
          return (
            <button
              key={o.label} type="button" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => toggle(o.label)}
              className={clsx(
                'flex items-start gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                on ? 'border-text-2 bg-accent-soft text-text' : 'border-rule-2 bg-bg text-text-2 hover:border-text-3 hover:bg-bg-2 hover:text-text',
              )}
            >
              <kbd className="mt-px rounded-sm border border-rule-2 bg-bg-2 px-1.5 font-mono text-xs text-text-3">{i + 1}</kbd>
              <span className="flex-1">
                {o.label}
                {o.hint && <span className="mt-0.5 block text-xs text-text-3">{o.hint}</span>}
              </span>
              {on && <Check size={14} className="mt-0.5 text-text-2" aria-hidden />}
            </button>
          );
        })}
        <input
          type="text" value={cur?.other ?? ''} onChange={e => setOther(e.target.value)} aria-label="Something else"
          placeholder="Something else…" autoComplete="off"
          className="rounded-md border border-rule-2 bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-text-3 focus:border-text-3"
        />
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-2">
        <span className="text-xs text-text-3">Esc to skip</span>
        <div className="flex gap-2">
          <button type="button" className="err-btn" onClick={onSkip}>Skip</button>
          <button type="button" className="err-btn primary inline-flex items-center gap-1" onClick={next} data-testid="clarify-next">
            {last ? 'Continue' : 'Next'}
            {!last && <ChevronRight size={14} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
