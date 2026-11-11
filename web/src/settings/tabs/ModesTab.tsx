import { useState } from 'react';
import { Plus, MessagesSquare } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../state/app-store';
import { useUiStore } from '../../state/ui-store';
import { toast } from '../../ui/toast';
import { ModeIcon } from '../ModeIcon';
import { CUSTOM_MODE_ICON, DEFAULT_MODE_ID, deleteMode, getModes, resetMode, saveMode, type Mode } from '../modes';
import { INPUT } from '../fields';
import { HeaderActions } from '../header-slot';
import { BTN, BTN_DANGER, BTN_PRIMARY, EmptyState, PageBody } from '../ui';

const NEW_ID = '__new__';
const LABEL = 'mb-2 font-mono text-xs uppercase tracking-widest text-text-3';

/** Master/detail. A mode is a system prompt; saving is explicit (Save / Create), as it was in the old dialog. */
export function ModesTab() {
  const prefs = useAppStore(s => s.prefs);
  const [sel, setSel] = useState<string | null>(null);
  const modes: Mode[] = getModes(prefs);
  const drafting = sel === NEW_ID;
  if (drafting) modes.unshift({ id: NEW_ID, label: '', desc: '', instructions: '', icon: CUSTOM_MODE_ICON, builtin: false, edited: false });

  const current = modes.find(m => m.id === sel) ?? modes[0];
  const active = prefs.mode || DEFAULT_MODE_ID;
  const startNew = (): void => setSel(NEW_ID);

  return (
    <>
      <HeaderActions>
        <button type="button" className={BTN_PRIMARY} onClick={startNew}><Plus size={14} aria-hidden />New mode</button>
      </HeaderActions>
      <PageBody>
        {!current ? (
          <EmptyState icon={<MessagesSquare size={18} />} title="No modes" action={<button type="button" className={BTN_PRIMARY} onClick={startNew}><Plus size={14} aria-hidden />New mode</button>}>
            A mode is a system prompt that shapes how the assistant responds. Create one to get started.
          </EmptyState>
        ) : (
          <div className="flex items-start gap-[18px] max-md:flex-col">
            <div role="listbox" aria-label="Modes" className="flex w-[230px] flex-none flex-col gap-1.5 max-md:w-full">
              {modes.map(m => (
                <button
                  key={m.id} type="button" role="option" aria-selected={m.id === current.id} data-mode={m.id} onClick={() => setSel(m.id)}
                  className={clsx('flex items-center gap-2.5 rounded-[11px] border px-3 py-2.5 text-left', m.id === current.id ? 'border-text bg-bg-2' : 'border-rule bg-surface hover:bg-bg-2')}
                >
                  <ModeIcon name={m.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">{m.label || 'New mode'}</span>
                    <span className="block truncate text-xs text-text-3">{m.id === active ? 'Active' : m.desc || (m.builtin ? 'Built-in' : 'Custom')}</span>
                  </span>
                </button>
              ))}
            </div>
            <ModeEditor key={current.id} mode={current} onSelect={setSel} />
          </div>
        )}
      </PageBody>
    </>
  );
}

function ModeEditor({ mode: m, onSelect }: { mode: Mode; onSelect(id: string | null): void }) {
  const editModes = useAppStore(s => s.editModes);
  const askConfirm = useUiStore(s => s.askConfirm);
  const isNew = m.id === NEW_ID;
  const [label, setLabel] = useState(m.label);
  const [desc, setDesc] = useState(m.desc);
  const [instructions, setInstructions] = useState(m.instructions);
  const dirty = label !== m.label || desc !== m.desc || instructions !== m.instructions;

  const save = async (): Promise<void> => {
    const name = label.trim();
    if (!name) { toast('Give the mode a name'); return; }
    const id = await editModes(p => saveMode(p, { id: isNew ? '' : m.id, label: name, desc: desc.trim(), instructions: instructions.trim() }));
    onSelect(id);
    toast(isNew ? `Created "${name}"` : `Saved "${name}"`);
  };
  const reset = async (): Promise<void> => {
    await editModes(p => resetMode(p, m.id));
    onSelect(m.id);
    toast('Reset to default');
  };
  const remove = async (): Promise<void> => {
    const ok = await askConfirm({
      heading: 'Delete mode?', name: m.label, before: 'This removes the mode',
      after: '. Chats using it fall back to General.', actionLabel: 'Delete mode',
    });
    if (!ok) return;
    await editModes(p => deleteMode(p, m.id));
    onSelect(null);
    toast('Mode deleted');
  };

  return (
    <div className="min-w-0 flex-1 rounded-[14px] border border-rule bg-surface p-[18px]">
      <div className={LABEL}>Name</div>
      <input className={`${INPUT} h-[38px]`} aria-label="Name" maxLength={30} value={label} placeholder="e.g. Teacher" autoFocus={isNew} onChange={e => setLabel(e.target.value)} />
      <div className={`${LABEL} mt-[18px]`}>Short description</div>
      <input className={`${INPUT} h-[38px]`} aria-label="Short description" maxLength={50} value={desc} placeholder="Shown under the name in the menu" onChange={e => setDesc(e.target.value)} />
      <div className={`${LABEL} mt-[18px]`}>System prompt</div>
      <textarea
        className={`${INPUT} resize-y leading-relaxed`} aria-label="Instructions" rows={10} value={instructions}
        placeholder="How should the assistant think, respond and push back in this mode?" onChange={e => setInstructions(e.target.value)}
      />
      <p className="m-0 mt-2 text-xs leading-normal text-text-3">Added to the system prompt for every chat in this mode. Switch the active mode from the composer.</p>
      <div className="mt-4 flex items-center gap-2">
        {m.builtin && m.edited && <button type="button" className={BTN} onClick={() => { void reset(); }}>Reset to default</button>}
        {!isNew && !m.builtin && <button type="button" className={BTN_DANGER} onClick={() => { void remove(); }}>Delete</button>}
        {m.builtin && !m.edited && <span className="text-xs text-text-3">Built-in modes can be edited but not deleted.</span>}
        <span className="flex-1" />
        {isNew && <button type="button" className={BTN} onClick={() => onSelect(null)}>Cancel</button>}
        <button type="button" className={BTN_PRIMARY} disabled={!isNew && !dirty} onClick={() => { void save(); }}>{isNew ? 'Create' : 'Save'}</button>
      </div>
    </div>
  );
}
