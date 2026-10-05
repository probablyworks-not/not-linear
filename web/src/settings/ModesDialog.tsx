import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Cpu, Code, MessageSquare, Plus, Sparkles, Swords, Telescope, Users, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { toast } from '../ui/toast';
import { INPUT } from './fields';
import { CUSTOM_MODE_ICON, DEFAULT_MODE_ID, deleteMode, getMode, getModes, resetMode, saveMode, type Mode } from './modes';

// Ports views/modes-modal.js. Copy (headings, placeholders, toasts, the delete
// confirmation) is carried over verbatim; it is user-visible.

const NEW_ID = '__new__';

// Legacy stores Tabler class names in the mode data, and a custom mode saved by
// either app carries one. lucide has no 1:1 set, so map the ones that exist and
// fall back to the sparkle every custom mode gets anyway.
const ICON_SIZE = 14;
export function ModeIcon({ name }: { name: string }) {
  switch (name) {
    case 'ti-message-2': return <MessageSquare size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-telescope': return <Telescope size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-code': return <Code size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-users': return <Users size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-cpu': return <Cpu size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    case 'ti-sword': return <Swords size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
    default: return <Sparkles size={ICON_SIZE} className="flex-none text-text-2" aria-hidden />;
  }
}

export function ModesDialog() {
  const open = useUiStore(s => s.modesOpen);
  const setOpen = useUiStore(s => s.setModesOpen);
  const [openId, setOpenId] = useState<string | null>(null);
  const prefs = useAppStore(s => s.prefs);

  const close = (): void => { setOpen(false); setOpenId(null); };
  useEscLayer('modes', ESC_PRIORITY.modesModal, open, close);

  const modes: Mode[] = getModes(prefs);
  if (openId === NEW_ID) {
    modes.unshift({ id: NEW_ID, label: '', desc: '', instructions: '', icon: CUSTOM_MODE_ICON, builtin: false, edited: false });
  }

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[340] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby="modes-sub"
          onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[341] flex max-h-[calc(100vh-48px)] w-[min(560px,calc(100vw-36px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[10px] border border-rule-2 bg-surface shadow-lg"
        >
          <div className="flex items-center gap-2 px-4 pb-1 pt-4">
            <Dialog.Title className="m-0 flex-1 text-base font-semibold text-text">Modes</Dialog.Title>
            <button
              type="button" onClick={() => setOpenId(NEW_ID)}
              className="flex h-7 items-center gap-1.5 rounded-md border border-rule-2 px-2.5 text-xs text-text-2 hover:bg-bg-3 hover:text-text"
            >
              <Plus size={12} aria-hidden />New mode
            </button>
            <Dialog.Close
              aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"
            >
              <X size={14} />
            </Dialog.Close>
          </div>
          <p id="modes-sub" className="m-0 px-4 pb-2.5 text-xs text-text-3">
            Instructions added to the system prompt. Applies to every chat.
          </p>
          <div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-3">
            {modes.map(m => (
              <ModeRow
                key={m.id} mode={m} active={m.id === (prefs.mode || DEFAULT_MODE_ID)} expanded={openId === m.id}
                onToggle={() => setOpenId(openId === m.id ? null : m.id)}
                onDone={() => setOpenId(null)}
              />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModeRow({ mode: m, active, expanded, onToggle, onDone }: {
  mode: Mode; active: boolean; expanded: boolean; onToggle(): void; onDone(): void;
}) {
  const badge = m.builtin ? (m.edited ? 'Edited' : 'Built-in') : 'Custom';
  return (
    <div className={clsx('rounded-lg', expanded && 'bg-bg-2')} data-mode={m.id}>
      <button
        type="button" onClick={onToggle} aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-sm text-text hover:bg-bg-3"
      >
        <ModeIcon name={m.icon} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span>{m.label}</span>
          {m.desc && <span className="mt-px text-xs text-text-3">{m.desc}</span>}
        </span>
        {active && <span className="rounded-[5px] border border-accent px-1.5 py-px text-xs text-accent">Active</span>}
        <span className="rounded-[5px] border border-rule-2 px-1.5 py-px text-xs text-text-3">{badge}</span>
        <ChevronDown size={12} aria-hidden className={clsx('flex-none text-text-3 transition-transform duration-150', expanded && 'rotate-180')} />
      </button>
      {expanded && <ModeEditor mode={m} onDone={onDone} />}
    </div>
  );
}

function ModeEditor({ mode: m, onDone }: { mode: Mode; onDone(): void }) {
  const editModes = useAppStore(s => s.editModes);
  const askConfirm = useUiStore(s => s.askConfirm);
  const isNew = m.id === NEW_ID;
  const [label, setLabel] = useState(m.label);
  const [desc, setDesc] = useState(m.desc);
  const [instructions, setInstructions] = useState(m.instructions);

  const save = async (): Promise<void> => {
    const name = label.trim();
    if (!name) { toast('Give the mode a name'); return; }
    await editModes(p => saveMode(p, { id: isNew ? '' : m.id, label: name, desc: desc.trim(), instructions: instructions.trim() }));
    onDone();
    toast(isNew ? `Created "${name}"` : `Saved "${name}"`);
  };

  const reset = async (): Promise<void> => {
    await editModes(p => resetMode(p, m.id));
    onDone();
    toast('Reset to default');
  };

  const remove = async (): Promise<void> => {
    const name = getMode(useAppStore.getState().prefs, m.id).label;
    const ok = await askConfirm({
      heading: 'Delete mode?', name, before: 'This removes the mode',
      after: '. Chats using it fall back to General.', actionLabel: 'Delete mode',
    });
    if (!ok) return;
    await editModes(p => deleteMode(p, m.id));
    onDone();
    toast('Mode deleted');
  };

  const field = 'flex flex-col gap-1 text-xs text-text-3';
  return (
    <div className="flex flex-col gap-2.5 px-2.5 pb-3 pt-1">
      <label className={field}>Name
        <input className={INPUT} aria-label="Name" maxLength={30} value={label} placeholder="e.g. Teacher" autoFocus onChange={e => setLabel(e.target.value)} />
      </label>
      <label className={field}>Short description
        <input className={INPUT} aria-label="Short description" maxLength={50} value={desc} placeholder="Shown under the name in the menu" onChange={e => setDesc(e.target.value)} />
      </label>
      <label className={field}>Instructions
        <textarea
          className={`${INPUT} resize-y`} aria-label="Instructions" rows={8} value={instructions}
          placeholder="How should Claude respond in this mode? Added to the system prompt."
          onChange={e => setInstructions(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-2">
        {m.builtin && m.edited && <ModeButton onClick={() => { void reset(); }}>Reset to default</ModeButton>}
        {!isNew && !m.builtin && <ModeButton danger onClick={() => { void remove(); }}>Delete</ModeButton>}
        <span className="flex-1" />
        <ModeButton onClick={onDone}>Cancel</ModeButton>
        <ModeButton primary onClick={() => { void save(); }}>{isNew ? 'Create' : 'Save'}</ModeButton>
      </div>
    </div>
  );
}

function ModeButton({ children, onClick, primary, danger }: { children: string; onClick(): void; primary?: boolean; danger?: boolean }) {
  return (
    <button
      type="button" onClick={onClick}
      className={clsx(
        'h-[30px] rounded-md border px-3 text-sm',
        primary ? 'border-accent bg-accent-soft text-text hover:bg-bg-3'
          : danger ? 'border-danger-border text-danger hover:bg-danger-soft'
          : 'border-rule-2 text-text-2 hover:bg-bg-3 hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
