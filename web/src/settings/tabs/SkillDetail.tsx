import { useState } from 'react';
import { ArrowLeft, Download, Minus, Plus, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from '../../ui/toast';
import { useUiStore } from '../../state/ui-store';
import { serializeSkill } from '../../skills/parse-skill';
import { useSkillsStore } from '../../skills/skills-store';
import type { ResolvedSkill } from '../../skills/types';
import { INPUT } from '../fields';
import { BTN, BTN_DANGER, Toggle } from '../ui';

/** Full-page skill editor over the list. Edits apply as you type (the store debounces the write). */
export function SkillDetail({ skill: s, onBack, onRenamed }: { skill: ResolvedSkill; onBack(): void; onRenamed(name: string): void }) {
  const { save, remove, rename, setPinned } = useSkillsStore();
  const askConfirm = useUiStore(a => a.askConfirm);
  const [name, setName] = useState(s.name);
  const [kw, setKw] = useState('');
  const custom = !s.builtin;
  const lines = s.body ? s.body.split('\n').length : 0;

  const commitName = (): void => {
    if (!custom || name === s.name) { setName(s.name); return; }
    const next = rename(s.name, name);
    if (next) { onRenamed(next); setName(next); toast(`Renamed to "${next}"`); }
    else { setName(s.name); toast('Skill names must be unique and not empty'); }
  };
  const addKeyword = (): void => {
    const word = kw.trim();
    setKw('');
    if (!word || s.keywords.some(k => k.toLowerCase() === word.toLowerCase())) return;
    save(s.name, { keywords: [...s.keywords, word] });
  };
  const exportMd = (): void => {
    const url = URL.createObjectURL(new Blob([serializeSkill(s)], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${s.name}.SKILL.md`; a.click();
    URL.revokeObjectURL(url);
  };
  const del = async (): Promise<void> => {
    if (custom && !(await askConfirm({ heading: 'Delete skill?', name: s.name, before: 'This removes the skill', after: '.', actionLabel: 'Delete skill' }))) return;
    remove(s.name);
    if (custom) onBack();
    toast(custom ? `Deleted "${s.name}"` : 'Reset to built-in');
  };

  const label = 'text-sm font-semibold text-text';
  const hint = 'mb-2 text-xs text-text-3';
  const area = `${INPUT} min-h-[96px] resize-none leading-relaxed`;
  return (
    <div role="region" aria-label={`Skill ${s.name}`} className="absolute inset-0 z-10 flex min-h-0 flex-col bg-bg">
      <div className="flex items-center gap-2.5 border-b border-rule px-7 py-3.5">
        <button type="button" className={BTN} onClick={onBack}><ArrowLeft size={14} aria-hidden />All skills</button>
        <span className="text-sm text-text-3">Skills / {s.name}</span>
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col gap-6 overflow-y-auto px-9 pb-10 pt-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            aria-label="Skill name" value={name} readOnly={!custom} title={custom ? undefined : 'Built-in skill names are fixed'}
            onChange={e => setName(e.target.value)} onBlur={commitName} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="min-w-[220px] flex-1 border-none bg-transparent p-0 text-xl font-semibold tracking-tight text-text outline-none"
          />
          <span className="rounded-md border border-rule-2 px-2 py-0.5 font-mono text-xs text-text-3">{custom ? 'Custom' : s.edited ? 'Edited' : 'Built-in'}</span>
          <button type="button" className={clsx(BTN, 'h-8')} onClick={exportMd}><Download size={14} aria-hidden />Export</button>
          {(custom || s.edited) && (
            <button type="button" aria-label={custom ? 'Delete skill' : 'Reset to built-in'} className={clsx(BTN_DANGER, 'h-8')} onClick={() => { void del(); }}>
              <Trash2 size={14} aria-hidden />{custom ? 'Delete' : 'Reset to built-in'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <label className="block">
            <div className={label}>What it does</div><div className={hint}>Shown in lists. Also used for matching.</div>
            <textarea className={area} rows={4} value={s.description} onChange={e => save(s.name, { description: e.target.value })} />
          </label>
          <label className="block">
            <div className={label}>When to use it</div><div className={hint}>A trigger sentence the router reads.</div>
            <textarea className={area} rows={4} value={s.whenToUse} placeholder="e.g. Use when weighing a decision before committing." onChange={e => save(s.name, { whenToUse: e.target.value })} />
          </label>
        </div>

        <div>
          <div className={`${label} mb-2`}>Keywords</div>
          <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-rule-2 bg-surface px-2.5 py-2 focus-within:border-text-2">
            {s.keywords.map(k => (
              <span key={k} className="flex items-center gap-1 rounded-full bg-bg-3 py-0.5 pl-2.5 pr-1.5 text-xs text-text">
                {k}
                <button type="button" aria-label={`Remove keyword ${k}`} className="grid place-items-center text-text-3 hover:text-text" onClick={() => save(s.name, { keywords: s.keywords.filter(x => x !== k) })}><X size={12} /></button>
              </span>
            ))}
            <input
              aria-label="Add keyword" placeholder="Add keyword, press Enter" value={kw} onChange={e => setKw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
              className="h-[26px] min-w-[140px] flex-1 border-none bg-transparent text-sm text-text outline-none placeholder:text-text-3"
            />
          </div>
        </div>

        <div className="flex min-h-[300px] flex-col">
          <div className="mb-2 flex items-baseline">
            <div className="min-w-0 flex-1"><span className={label}>Instructions</span><span className="ml-2 text-xs text-text-3">Markdown, sent to the model</span></div>
            <span data-testid="skill-stats" className="ml-3 whitespace-nowrap font-mono text-xs text-text-3">{lines} lines · {s.body.length} chars</span>
          </div>
          <textarea
            aria-label="Instructions" spellCheck={false} value={s.body} onChange={e => save(s.name, { body: e.target.value })}
            className={`${INPUT} min-h-[300px] flex-1 resize-y rounded-xl bg-surface-2 p-4 font-mono leading-loose`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-6 rounded-xl border border-rule bg-surface-2 px-4 py-3.5">
          <Switch label="Always on" sub="Added to every message" on={s.always} onChange={on => save(s.name, { always: on })} />
          <Switch label="Auto-select" sub="Router may pick it" on={s.auto} onChange={on => save(s.name, { auto: on })} />
          <Switch label="Pinned" sub="Your override, kept across updates" on={s.pinned} onChange={on => setPinned(s.name, on)} />
          <div className="flex-1" />
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-medium text-text">Priority</span>
            <div className="flex h-[34px] items-center rounded-[9px] border border-rule-2 bg-surface">
              <button type="button" aria-label="Lower priority" disabled={s.priority <= 0} className="grid h-full w-8 place-items-center text-text-2 hover:text-text disabled:opacity-40" onClick={() => save(s.name, { priority: Math.max(0, s.priority - 1) })}><Minus size={14} /></button>
              <span data-testid="skill-priority" className="min-w-7 text-center font-mono text-sm text-text">{s.priority}</span>
              <button type="button" aria-label="Raise priority" className="grid h-full w-8 place-items-center text-text-2 hover:text-text" onClick={() => save(s.name, { priority: s.priority + 1 })}><Plus size={14} /></button>
            </div>
          </div>
        </div>
        {s.tools.length > 0 && <p className="m-0 text-xs text-text-3">Tools (not yet wired): {s.tools.join(', ')}</p>}
      </div>
    </div>
  );
}

function Switch({ label, sub, on, onChange }: { label: string; sub: string; on: boolean; onChange(next: boolean): void }) {
  return (
    <div className="flex items-center gap-2.5">
      <Toggle on={on} label={label} onChange={onChange} />
      <span><span className="block text-sm font-medium text-text">{label}</span><span className="block text-xs text-text-3">{sub}</span></span>
    </div>
  );
}
