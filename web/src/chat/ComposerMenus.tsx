import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Crown, Diamond, Sparkles, Zap, Brain, Bot, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { toast } from '../ui/toast';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { MODELS } from '../settings/options';
import { getMode, getModes } from '../settings/modes';
import { ModeIcon } from '../settings/ModeIcon';
import { useBranchStore } from '../branch/branch-store';
import { branchModelPref, setBranchModelPref } from '../branch/actions';

// The two pickers under every composer: model (with the extended-thinking switch) and
// conversation mode. Ported from app.js:938-1157. The main composer edits `prefs.model` and
// `prefs.mode`; a branch's composer edits that branch's own model (ADR-045) and shares the
// global mode, exactly as in legacy.

const THINKING_MODELS = new Set(['opus', 'sonnet', 'opus-4-8', 'sonnet-4-6', 'deepseek-r1']);
export const MENU_ITEM = 'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm text-text hover:bg-bg-3';

function ModelIcon({ id }: { id: string }) {
  const cls = 'w-4 flex-none text-text-2';
  if (id.startsWith('opus')) return <Crown size={14} className={cls} />;
  if (id.startsWith('sonnet')) return <Sparkles size={14} className={cls} />;
  if (id === 'haiku') return <Zap size={14} className={cls} />;
  if (id === 'deepseek' || id === 'deepseek-pro') return <Bot size={14} className={cls} />;
  if (id === 'deepseek-r1') return <Brain size={14} className={cls} />;
  if (id.startsWith('gemini')) return <Diamond size={14} className={cls} />;
  return <Bot size={14} className={cls} />;
}

/** A menu that opens above its chip (below if there is no room), kept inside the window. */
export function FloatingMenu({ anchor, label, onClose, escId, escPriority, children }: {
  anchor: HTMLElement; label: string; onClose(): void; escId: string; escPriority: number; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), window.innerWidth - el.offsetWidth - 8);
    let top = r.top - el.offsetHeight - 6;
    if (top < 8) top = r.bottom + 6;
    top = Math.max(8, Math.min(top, window.innerHeight - el.offsetHeight - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [anchor, onClose]);
  useEscLayer(escId, escPriority, true, onClose);
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="fixed z-[220] max-h-[calc(100vh-40px)] min-w-[210px] overflow-y-auto rounded-lg border border-rule-2 bg-surface-2 p-1 shadow-lg">
      {children}
    </div>,
    document.body
  );
}

/** `branchId` null edits the main composer's model; a branch id edits that branch's. */
export function ModelMenu({ anchor, branchId, onClose }: { anchor: HTMLElement; branchId: string | null; onClose(): void }) {
  const prefs = useAppStore(s => s.prefs);
  const setPref = useAppStore(s => s.setPref);
  const branch = useBranchStore(s => (branchId ? s.open[branchId] : undefined));
  const current = branchId ? branchModelPref(branch, prefs.model) : (prefs.model || 'sonnet');
  const supported = THINKING_MODELS.has(current);
  const on = !!(prefs.thinking && supported);

  const choose = (id: string): void => {
    const label = MODELS.find(m => m.id === id)?.label ?? id;
    if (branchId) { void setBranchModelPref(branchId, id); toast(`Branch model set to ${label}`); }
    else { void setPref('model', id); toast(`Model set to ${label}`); }
    onClose();
  };
  const toggleThinking = (): void => {
    if (!supported) return;
    void setPref('thinking', !on);
    toast(!on ? 'Extended thinking on' : 'Extended thinking off');
  };

  return (
    <FloatingMenu anchor={anchor} label="Select model" onClose={onClose} escId="modelMenu" escPriority={ESC_PRIORITY.modelMenu}>
      {MODELS.map(m => (
        <button key={m.id} type="button" role="menuitem" data-model={m.id} className={clsx(MENU_ITEM, m.id === current && 'bg-accent-soft')} onClick={() => choose(m.id)}>
          <ModelIcon id={m.id} />
          <span className="flex-1">{m.label}<span className="block text-xs text-text-3">{m.blurb}</span></span>
          {m.id === current && <Check size={14} className="text-accent" />}
        </button>
      ))}
      <div className="my-[3px] h-px bg-rule" />
      <div className={clsx('flex items-center justify-between gap-2.5 px-3 pb-1.5 pt-2', !supported && 'opacity-40')}>
        <span className="text-sm text-text-2">Extended thinking</span>
        <button
          type="button" role="switch" aria-checked={on} aria-label="Extended thinking" disabled={!supported} onClick={toggleThinking}
          title="Deeper reasoning before answering. Opus, Sonnet, and DeepSeek Thinking only."
          className={clsx('relative h-[18px] w-8 flex-none rounded-full border transition-colors', on ? 'border-accent bg-accent' : 'border-rule bg-bg-3')}
        >
          <span className={clsx('absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-bg shadow-md transition-transform', on && 'translate-x-3.5')} />
        </button>
      </div>
      <p className="px-3 pb-2 text-xs italic text-text-3">
        {current === 'deepseek-r1' ? 'DeepSeek Thinking always reasons — toggle shows/hides it.' : 'Deeper reasoning. Adds 3–8s. Opus and Sonnet only.'}
      </p>
    </FloatingMenu>
  );
}

export function ModeMenu({ anchor, onClose }: { anchor: HTMLElement; onClose(): void }) {
  const prefs = useAppStore(s => s.prefs);
  const setPref = useAppStore(s => s.setPref);
  const openSettings = useUiStore(s => s.openSettings);
  const current = getMode(prefs).id;
  return (
    <FloatingMenu anchor={anchor} label="Select conversation mode" onClose={onClose} escId="modeMenu" escPriority={ESC_PRIORITY.modeMenu}>
      {getModes(prefs).map(m => (
        <button
          key={m.id} type="button" role="menuitem" data-mode={m.id} className={clsx(MENU_ITEM, m.id === current && 'bg-accent-soft')}
          onClick={() => { void setPref('mode', m.id); toast(`Mode: ${m.label}`); onClose(); }}
        >
          <ModeIcon name={m.icon} />
          <span className="flex-1">{m.label}{m.desc && <span className="block text-xs text-text-3">{m.desc}</span>}</span>
          {m.id === current && <Check size={14} className="text-accent" />}
        </button>
      ))}
      <div className="my-[3px] h-px bg-rule" />
      <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { onClose(); openSettings('modes'); }}>
        <Plus size={14} className="w-4 flex-none text-text-2" />
        <span>New / manage modes<span className="block text-xs text-text-3">Edit prompts and instructions</span></span>
      </button>
    </FloatingMenu>
  );
}

/** The model chip, which opens the model menu. `branchId` null is the main composer's. */
export function ModelChip({ branchId, className }: { branchId: string | null; className?: string }) {
  const prefs = useAppStore(s => s.prefs);
  const branch = useBranchStore(s => (branchId ? s.open[branchId] : undefined));
  const id = branchId ? branchModelPref(branch, prefs.model) : (prefs.model || 'sonnet');
  const label = (MODELS.find(m => m.id === id) ?? MODELS.find(m => m.id === 'sonnet')!).label;
  return <ChipMenu className={className} title="Select model" icon={<Sparkles size={14} />} label={label} labelClass="model-label" menu={(anchor, close) => <ModelMenu anchor={anchor} branchId={branchId} onClose={close} />} />;
}

export function ModeChip({ className }: { className?: string }) {
  const prefs = useAppStore(s => s.prefs);
  const mode = getMode(prefs);
  return <ChipMenu className={className} title="Conversation mode" icon={<ModeIcon name={mode.icon} />} label={mode.label} labelClass="mode-label" menu={(anchor, close) => <ModeMenu anchor={anchor} onClose={close} />} />;
}


function ChipMenu({ title, icon, label, labelClass, className, menu }: {
  title: string; icon: ReactNode; label: string; labelClass: string; className?: string;
  menu(anchor: HTMLElement, close: () => void): ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <>
      <button
        type="button" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={!!anchor}
        className={clsx('chip', className)}
        // Read the element NOW: inside the updater React has already reset `currentTarget` (the pointer-event landmine).
        onClick={e => { const el = e.currentTarget; setAnchor(prev => (prev ? null : el)); }}
      >
        {icon}<span className={labelClass}>{label}</span><ChevronDown size={11} />
      </button>
      {anchor && menu(anchor, close)}
    </>
  );
}
