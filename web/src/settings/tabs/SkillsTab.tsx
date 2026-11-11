import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Layers, Pin, Plus, Shuffle, Sparkles, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from '../../ui/toast';
import { ESC_PRIORITY, useEscLayer } from '../../lib/keyboard';
import { parseSkill } from '../../skills/parse-skill';
import { selectSkills } from '../../skills/select-skills';
import { flushSkillWrites, resolvedSkills, useSkillsStore } from '../../skills/skills-store';
import type { ResolvedSkill } from '../../skills/types';
import { INPUT } from '../fields';
import { DetailOverlay, HeaderActions } from '../header-slot';
import { BTN, BTN_PRIMARY, EmptyState, PageBody, Toggle } from '../ui';
import { SkillDetail } from './SkillDetail';

const LAYER_ICON: Record<string, typeof Layers> = { foundation: Layers, meta: Shuffle, custom: Sparkles };

export function SkillsTab() {
  const store = useSkillsStore();
  const [openName, setOpenName] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [probe, setProbe] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void store.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- external sync with IndexedDB
  useEffect(() => () => { void flushSkillWrites(); }, []); // typed edits are debounced; leaving the tab must not lose them

  const skills = useMemo(() => resolvedSkills(store), [store.overrides, store.custom, store.meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? skills.filter(s => `${s.name} ${s.description} ${s.keywords.join(' ')} ${s.layer}`.toLowerCase().includes(needle)) : skills;
  }, [skills, q]);
  const preview = useMemo(
    () => (probe.trim() ? selectSkills({ skills, meta: store.meta, query: probe }) : []),
    [probe, skills, store.meta],
  );

  // A skill deleted or renamed elsewhere simply stops matching: the list shows instead of a stale detail.
  const current = openName ? skills.find(s => s.name === openName) : undefined;
  useEscLayer('settings-skill', ESC_PRIORITY.settingsDetail, !!current, () => setOpenName(null));

  const add = (): void => { const name = store.create({ name: 'new skill', description: '', body: '# New skill\n\n' }); setQ(''); setOpenName(name); };
  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const parsed = parseSkill(await file.text());
    if (!parsed) { toast('Not a SKILL.md: needs frontmatter with a name'); return; }
    const name = store.create({ ...parsed, layer: 'custom' });
    setOpenName(name);
    toast(`Imported "${name}"`);
  };

  return (
    <>
      <HeaderActions>
        <button type="button" className={BTN} onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden />Import</button>
        <input ref={fileRef} type="file" accept=".md,text/markdown" hidden aria-label="Import skill file" onChange={e => { void onImport(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className={BTN_PRIMARY} onClick={add}><Plus size={14} aria-hidden />New skill</button>
      </HeaderActions>

      <PageBody>
        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <input className={`${INPUT} max-w-[260px]`} placeholder="Search skills" aria-label="Search skills" value={q} onChange={e => setQ(e.target.value)} />
          <input className={`${INPUT} max-w-[320px]`} placeholder="Test a message: see which skills would fire" aria-label="Test a message" value={probe} onChange={e => setProbe(e.target.value)} />
          <div className="flex-1" />
          <label className="flex items-center gap-2.5 text-sm text-text-2">
            <Toggle on={store.meta.auto} label="Pick skills automatically" onChange={store.setAuto} />
            Pick automatically
          </label>
        </div>
        {probe.trim() && (
          <div className="mb-5 rounded-lg border border-rule bg-surface-2 p-3 text-xs text-text-3" data-testid="skills-preview">
            {preview.length
              ? preview.map(p => <div key={p.skill.name}><span className="text-text">{p.skill.name}</span> · {p.reason}{p.reason === 'match' ? ` · ${p.score.toFixed(1)} · ${p.matched.join(', ')}` : ''}</div>)
              : 'No skill would be added.'}
          </div>
        )}

        {skills.length === 0 ? (
          <EmptyState icon={<BookOpen size={18} />} title="No skills yet" action={<button type="button" className={BTN_PRIMARY} onClick={add}><Plus size={14} aria-hidden />New skill</button>}>
            Skills are reusable methods added to the system prompt. Create one, or import a SKILL.md file.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState icon={<BookOpen size={18} />} title="No skills match" action={<button type="button" className={BTN} onClick={() => setQ('')}>Clear search</button>}>
            Nothing matches "{q.trim()}". Try a keyword from the skill's description.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
            {shown.map(s => <SkillCard key={s.name} skill={s} onOpen={() => setOpenName(s.name)} />)}
          </div>
        )}
      </PageBody>

      {current && (
        <DetailOverlay>
          <SkillDetail key={current.name} skill={current} onBack={() => setOpenName(null)} onRenamed={setOpenName} />
        </DetailOverlay>
      )}
    </>
  );
}

function SkillCard({ skill: s, onOpen }: { skill: ResolvedSkill; onOpen(): void }) {
  const setEnabled = useSkillsStore(a => a.setEnabled);
  const Icon = LAYER_ICON[s.layer] ?? BookOpen;
  const tag = s.builtin ? (s.edited ? 'Edited' : 'Built-in') : 'Custom';
  return (
    <article data-skill={s.name} data-enabled={s.enabled} className={clsx('relative flex flex-col rounded-2xl border border-rule bg-surface p-4 transition-shadow duration-150 hover:shadow-md', !s.enabled && 'opacity-60')}>
      {/* One button covers the card; the toggle sits above it, so a click on it never opens the detail. */}
      <button type="button" aria-label={`Open ${s.name}`} onClick={onOpen} className="absolute inset-0 rounded-2xl" />
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] bg-bg-2 text-text-2"><Icon size={17} /></span>
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-text">{s.name}</div>
        <div className="relative z-10"><Toggle on={s.enabled} label={`Enable ${s.name}`} onChange={on => setEnabled(s.name, on)} /></div>
      </div>
      <p className="m-0 mb-3.5 mt-3 line-clamp-3 min-h-[60px] text-sm leading-relaxed text-text-2">{s.description || 'No description yet.'}</p>
      <div className="flex items-center gap-1.5">
        <span className="rounded-md bg-bg-2 px-2 py-0.5 font-mono text-xs text-text-3">{tag}</span>
        {(s.always || s.pinned) && <span className="flex items-center gap-1 text-xs text-text-2"><Pin size={11} aria-hidden />Always on</span>}
      </div>
    </article>
  );
}
