import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CornerDownLeft, MessageCircleQuestion, Pencil } from 'lucide-react';
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

  const hasPick = !!answerOf(cur);
  const Mark = q.multi ? 'rounded-sm' : 'rounded-full';

  return (
    <div className="animate-[fadein_160ms_ease-out]">
      <div
        ref={root} tabIndex={-1} onKeyDown={onKeyDown} data-testid="clarify-card" role="group" aria-label="Clarifying questions"
        className="rounded-xl border border-rule-2 bg-bg-2 p-4 shadow-md outline-none"
      >
        <div className="mb-3 flex items-center gap-3 text-text-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-bg-3 text-text">
            <MessageCircleQuestion size={14} aria-hidden />
          </span>
          <span className="flex-1 font-mono text-xs uppercase tracking-widest">A few quick questions</span>
          <span className="flex items-center gap-1.5 font-mono text-xs" aria-label={`Question ${step + 1} of ${questions.length}`}>
            <button type="button" aria-label="Previous question" disabled={step === 0} onClick={() => setStep(step - 1)} className="grid h-5 w-5 place-items-center rounded-sm hover:text-text disabled:opacity-40">
              <ChevronLeft size={14} aria-hidden />
            </button>
            <span>{step + 1} / {questions.length}</span>
            <button type="button" aria-label="Next question" disabled={last} onClick={() => setStep(step + 1)} className="grid h-5 w-5 place-items-center rounded-sm hover:text-text disabled:opacity-40">
              <ChevronRight size={14} aria-hidden />
            </button>
          </span>
        </div>

        <p className="text-base font-semibold text-text" data-testid="clarify-question">{q.question}</p>
        <p className="mb-3 mt-0.5 text-sm text-text-2">{q.multi ? 'Pick any that apply — or tell me something different.' : 'Pick one — or tell me something different.'}</p>
        <div className="flex flex-col gap-1.5" role={q.multi ? 'group' : 'radiogroup'}>
          {q.options.map((o, i) => {
            const on = !!cur?.labels.includes(o.label);
            return (
              <button
                key={o.label} type="button" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => toggle(o.label)}
                className={clsx(
                  'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  on ? 'border-text-2 bg-accent-soft' : 'border-rule-2 bg-bg hover:border-text-3 hover:bg-surface',
                )}
              >
                <kbd className="grid h-6 w-6 flex-none place-items-center rounded-md border border-rule-2 bg-bg-3 font-mono text-xs text-text-2">{i + 1}</kbd>
                <span className="flex-1">
                  <span className="block text-sm text-text">{o.label}</span>
                  {o.hint && <span className="block text-xs text-text-2">{o.hint}</span>}
                </span>
                <span className={clsx('grid h-5 w-5 flex-none place-items-center border transition-colors', Mark, on ? 'border-text bg-text text-bg' : 'border-text-3')}>
                  {on && <Check size={12} aria-hidden />}
                </span>
              </button>
            );
          })}
          <label className="flex items-center gap-3 rounded-lg border border-dashed border-text-3 px-3 py-2 focus-within:border-text-2">
            <Pencil size={14} className="mx-1 flex-none text-text-2" aria-hidden />
            <input
              type="text" value={cur?.other ?? ''} onChange={e => setOther(e.target.value)} aria-label="Something else"
              placeholder="Something else…" autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-2"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-text-2">
            <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="inline-flex items-center gap-1.5 text-sm hover:text-text disabled:opacity-40">
              <ArrowLeft size={14} aria-hidden /> Back
            </button>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded-sm border border-rule-2 bg-bg-3 px-1.5 py-0.5 font-mono">Esc</kbd> to skip
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" className="err-btn px-3 py-1.5 text-sm" onClick={onSkip}>Skip</button>
            <button
              type="button" onClick={next} data-testid="clarify-next"
              className={clsx('err-btn inline-flex items-center gap-2 px-3 py-1.5 text-sm', hasPick && 'primary')}
            >
              {last ? 'Done' : 'Next'}
              <CornerDownLeft size={12} className="opacity-60" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-xs uppercase tracking-widest text-text-2">
        Keys 1–{q.options.length} select · Enter continues
      </p>
    </div>
  );
}
