import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Download, Pin, Plus, Upload, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useUiStore } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { toast } from '../ui/toast';
import { INPUT } from '../settings/fields';
import { parseSkill, serializeSkill } from './parse-skill';
import { selectSkills } from './select-skills';
import { flushSkillWrites, resolvedSkills, useSkillsStore } from './skills-store';
import type { ResolvedSkill } from './types';

// Browse, switch on/off, pin, edit, add, import/export skills; and "Test a message" shows what the
// BM25 selector would inject, with scores, so the metadata (description, when to use, keywords)
// can be tuned until the right skill fires.

const BTN = 'flex h-7 items-center gap-1.5 rounded-md border border-rule-2 px-2.5 text-xs text-text-2 hover:bg-bg-3 hover:text-text';

export function SkillsDialog() {
  const open = useUiStore(s => s.skillsOpen);
  const setOpen = useUiStore(s => s.setSkillsOpen);
  const store = useSkillsStore();
  const [openName, setOpenName] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [probe, setProbe] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) void store.load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- external sync with IndexedDB

  const close = (): void => { void flushSkillWrites(); setOpen(false); setOpenName(null); };
  useEscLayer('skills', ESC_PRIORITY.skillsModal, open, close);

  const skills = useMemo(() => resolvedSkills(store), [store.overrides, store.custom, store.meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? skills.filter(s => `${s.name} ${s.description} ${s.keywords.join(' ')} ${s.layer}`.toLowerCase().includes(needle)) : skills;
  }, [skills, q]);
  const groups = useMemo(() => {
    const m = new Map<string, ResolvedSkill[]>();
    for (const s of shown) m.set(s.layer, [...(m.get(s.layer) ?? []), s]);
    return [...m.entries()];
  }, [shown]);
  const preview = useMemo(
    () => (probe.trim() ? selectSkills({ skills, meta: store.meta, query: probe }) : []),
    [probe, skills, store.meta],
  );

  const add = (): void => { const name = store.create({ name: 'new skill', description: 'Describe what this skill does.' }); setQ(''); setOpenName(name); };
  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const parsed = parseSkill(await file.text());
    if (!parsed) { toast('Not a SKILL.md: needs frontmatter with a name'); return; }
    const name = store.create({ ...parsed, layer: 'custom' });
    setOpenName(name);
    toast(`Imported "${name}"`);
  };

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[340] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby="skills-sub" onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[341] flex max-h-[calc(100vh-48px)] w-[min(680px,calc(100vw-36px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[10px] border border-rule-2 bg-surface shadow-lg"
        >
          <div className="flex items-center gap-2 px-4 pb-1 pt-4">
            <Dialog.Title className="m-0 flex-1 text-base font-semibold text-text">Skills</Dialog.Title>
            <button type="button" className={BTN} onClick={() => fileRef.current?.click()}><Upload size={12} aria-hidden />Import</button>
            <input ref={fileRef} type="file" accept=".md,text/markdown" hidden onChange={e => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className={BTN} onClick={add}><Plus size={12} aria-hidden />New skill</button>
            <Dialog.Close aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"><X size={14} /></Dialog.Close>
          </div>
          <p id="skills-sub" className="m-0 px-4 pb-2 text-xs text-text-3">
            Added to the system prompt for every model. Each message picks the best-matching enabled skills from their description, when-to-use and keywords.
          </p>
          <div className="flex flex-col gap-2 px-4 pb-2">
            <label className="flex items-center gap-2 text-sm text-text-2">
              <input type="checkbox" checked={store.meta.auto} onChange={e => store.setAuto(e.target.checked)} />
              Pick skills automatically
            </label>
            <input className={INPUT} placeholder="Search skills" aria-label="Search skills" value={q} onChange={e => setQ(e.target.value)} />
            <input className={INPUT} placeholder="Test a message: see which skills would fire" aria-label="Test a message" value={probe} onChange={e => setProbe(e.target.value)} />
            {probe.trim() && (
              <div className="text-xs text-text-3" data-testid="skills-preview">
                {preview.length
                  ? preview.map(p => <div key={p.skill.name}><span className="text-text">{p.skill.name}</span> · {p.reason}{p.reason === 'match' ? ` · ${p.score.toFixed(1)} · ${p.matched.join(', ')}` : ''}</div>)
                  : 'No skill would be added.'}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto px-2 pb-3">
            {groups.map(([layer, list]) => (
              <section key={layer}>
                <h3 className="m-0 px-2 pb-0.5 pt-1 text-xs font-semibold uppercase tracking-wide text-text-3">{layer}</h3>
                {list.map(s => (
                  <SkillRow key={s.name} skill={s} expanded={openName === s.name} onToggle={() => setOpenName(openName === s.name ? null : s.name)} onGone={() => setOpenName(null)} />
                ))}
              </section>
            ))}
            {!groups.length && <p className="m-0 px-3 py-4 text-sm text-text-3">No skills match. Clear the search or add a new one.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SkillRow({ skill: s, expanded, onToggle, onGone }: { skill: ResolvedSkill; expanded: boolean; onToggle(): void; onGone(): void }) {
  const { setEnabled, setPinned } = useSkillsStore();
  const badge = s.builtin ? (s.edited ? 'Edited' : 'Built-in') : 'Custom';
  return (
    <div className={clsx('rounded-lg', expanded && 'bg-bg-2')} data-skill={s.name}>
      <div className="flex items-center gap-2 p-2">
        <input type="checkbox" aria-label={`Enable ${s.name}`} checked={s.enabled} onChange={e => setEnabled(s.name, e.target.checked)} />
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={clsx('flex min-w-0 flex-1 flex-col text-left text-sm hover:text-text', s.enabled ? 'text-text' : 'text-text-3')}>
          <span>{s.name}{s.always && <span className="ml-1.5 text-xs text-text-3">always on</span>}</span>
          <span className="mt-px truncate text-xs text-text-3">{s.description}</span>
        </button>
        <button type="button" aria-label={s.pinned ? `Unpin ${s.name}` : `Pin ${s.name}`} aria-pressed={s.pinned} title="Pin: add to every message" onClick={() => setPinned(s.name, !s.pinned)}
          className={clsx('grid h-6 w-6 place-items-center rounded-md hover:bg-bg-3', s.pinned ? 'text-accent' : 'text-text-3')}><Pin size={12} /></button>
        <span className="rounded-[5px] border border-rule-2 px-1.5 py-px text-xs text-text-3">{badge}</span>
        <ChevronDown size={12} aria-hidden className={clsx('flex-none text-text-3 transition-transform duration-150', expanded && 'rotate-180')} />
      </div>
      {expanded && <SkillEditor skill={s} onGone={onGone} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs text-text-3">{label}{children}</label>;
}

function SkillEditor({ skill: s, onGone }: { skill: ResolvedSkill; onGone(): void }) {
  const { save, remove } = useSkillsStore();
  const askConfirm = useUiStore(a => a.askConfirm);
  const [keywords, setKeywords] = useState(s.keywords.join(', '));
  const exportMd = (): void => {
    const url = URL.createObjectURL(new Blob([serializeSkill(s)], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${s.name}.SKILL.md`; a.click();
    URL.revokeObjectURL(url);
  };
  const del = async (): Promise<void> => {
    if (!s.builtin && !(await askConfirm({ heading: 'Delete skill?', name: s.name, before: 'This removes the skill', after: '.', actionLabel: 'Delete skill' }))) return;
    remove(s.name);
    onGone();
    toast(s.builtin ? 'Reset to built-in' : `Deleted "${s.name}"`);
  };
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <Field label="Description: what it does">
        <textarea className={`${INPUT} min-h-[52px] resize-y`} value={s.description} onChange={e => save(s.name, { description: e.target.value })} />
      </Field>
      <Field label="When to use: trigger sentence">
        <textarea className={`${INPUT} min-h-[52px] resize-y`} value={s.whenToUse} placeholder="e.g. Use when weighing a decision before committing." onChange={e => save(s.name, { whenToUse: e.target.value })} />
      </Field>
      <Field label="Keywords: comma-separated trigger terms">
        <input className={INPUT} value={keywords} onChange={e => { setKeywords(e.target.value); save(s.name, { keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) }); }} />
      </Field>
      <Field label="Instructions: sent to the model">
        <textarea className={`${INPUT} min-h-[160px] resize-y font-mono`} value={s.body} onChange={e => save(s.name, { body: e.target.value })} />
      </Field>
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-2">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.always} onChange={e => save(s.name, { always: e.target.checked })} />Always on</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={s.auto} onChange={e => save(s.name, { auto: e.target.checked })} />Auto-select</label>
        <label className="flex items-center gap-1.5">Priority
          <input type="number" className={`${INPUT} w-16`} value={s.priority} onChange={e => save(s.name, { priority: Number(e.target.value) || 0 })} />
        </label>
        {s.tools.length > 0 && <span className="text-text-3">Tools (not yet wired): {s.tools.join(', ')}</span>}
        <span className="flex-1" />
        <button type="button" className={BTN} onClick={exportMd}><Download size={12} aria-hidden />Export</button>
        {(s.edited || !s.builtin) && <button type="button" className={BTN} onClick={() => { void del(); }}>{s.builtin ? 'Reset to built-in' : 'Delete'}</button>}
      </div>
    </div>
  );
}
