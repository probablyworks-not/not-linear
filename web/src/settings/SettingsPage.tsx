import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Cable, KeyRound, MessagesSquare, Sparkles, SlidersHorizontal, Sprout, TerminalSquare, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore, type SettingsTab } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { flushSkillWrites, resolvedSkills, useSkillsStore } from '../skills/skills-store';
import { flags } from '../flags';
import { getModes } from './modes';
import { integrationCount, useIntegrationsStore } from './integrations-store';
import { HeaderSlot, OverlaySlot } from './header-slot';
import { GeneralTab } from './tabs/GeneralTab';
import { ModelsTab } from './tabs/ModelsTab';
import { SkillsTab } from './tabs/SkillsTab';
import { IntegrationsTab } from './tabs/IntegrationsTab';
import { ModesTab } from './tabs/ModesTab';
import { UpdatesTab } from './tabs/UpdatesTab';
import { LogsTab, useLogCount } from './tabs/LogsTab';

interface TabDef { id: SettingsTab; label: string; icon: LucideIcon; title: string; sub: string; show: boolean }

const TABS: readonly TabDef[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, title: 'General', sub: 'How notlinear looks and who it is talking to.', show: true },
  { id: 'models', label: 'Models & keys', icon: KeyRound, title: 'Models & keys', sub: 'Connect a provider to use its models. Keys stay on your device.', show: true },
  { id: 'skills', label: 'Skills', icon: Sprout, title: 'Skills', sub: 'Reusable methods added to the system prompt, picked per message.', show: flags.skills },
  { id: 'integrations', label: 'Integrations', icon: Cable, title: 'Integrations', sub: 'Connect apps, MCP servers and plugins the assistant can use.', show: true },
  { id: 'modes', label: 'Modes', icon: MessagesSquare, title: 'Modes', sub: 'System prompts that shape how the assistant reacts to you.', show: flags.modes },
  { id: 'updates', label: 'Product updates', icon: Sparkles, title: 'Product updates', sub: 'What changed in each notlinear release.', show: flags.changelog },
  { id: 'logs', label: 'Runtime logs', icon: TerminalSquare, title: 'Runtime logs', sub: 'Every model and tool request, newest first.', show: flags.logs },
];

const PANELS: Record<SettingsTab, () => ReactNode> = {
  general: () => <GeneralTab />,
  models: () => <ModelsTab />,
  skills: () => <SkillsTab />,
  integrations: () => <IntegrationsTab />,
  modes: () => <ModesTab />,
  updates: () => <UpdatesTab />,
  logs: () => <LogsTab />,
};

/**
 * Settings as a full page (it was a modal). A rail of tabs on the left, a header and the tab's
 * content on the right. Every change applies immediately; there is no Save button except where a
 * tab says so (modes). Mounted only while open, so tabs always initialise from the current state.
 */
export function SettingsPage() {
  const open = useUiStore(s => s.settingsOpen);
  return open ? <Page /> : null;
}

function Page() {
  const setOpen = useUiStore(s => s.setSettingsOpen);
  const stored = useUiStore(s => s.settingsTab);
  const setTab = useUiStore(s => s.setSettingsTab);
  const flushPrefs = useAppStore(s => s.flushPrefs);
  const prefs = useAppStore(s => s.prefs);
  const apiKeys = useAppStore(s => s.apiKeys);
  const skillsStore = useSkillsStore();
  const integrations = useIntegrationsStore();
  const logCount = useLogCount();
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const tabs = TABS.filter(t => t.show);
  // A tab hidden by a flag (or a stale value) falls back to the first one rather than rendering nothing.
  const tab = tabs.find(t => t.id === stored) ?? tabs[0]!;

  const close = (): void => { setOpen(false); void flushPrefs(); void flushSkillWrites(); };
  useEscLayer('settings-page', ESC_PRIORITY.settingsPage, true, close);

  useEffect(() => { void skillsStore.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- external sync with IndexedDB; gives the rail its skill count
  useEffect(() => { root.current?.focus(); }, []); // external sync with the DOM: keyboard users land inside the page

  const skillCount = useMemo(() => resolvedSkills(skillsStore).length, [skillsStore.overrides, skillsStore.custom, skillsStore.meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts: Partial<Record<SettingsTab, number>> = {
    models: Object.keys(apiKeys).length,
    skills: skillCount,
    integrations: integrationCount(integrations),
    modes: getModes(prefs).length,
    logs: logCount,
  };
  const name = prefs.name?.trim() || 'You';

  return (
    <div
      ref={root} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}
      className="fixed inset-0 z-[300] flex bg-bg text-text outline-none"
    >
      <nav aria-label="Settings sections" className="flex w-60 flex-none flex-col gap-1 border-r border-rule bg-surface-2 px-3 py-[22px] max-md:w-16">
        <div className="px-2.5 pb-3.5 text-base font-semibold max-md:hidden">Settings</div>
        <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-1">
          {tabs.map(t => {
            const on = t.id === tab.id;
            const count = counts[t.id];
            return (
              <button
                key={t.id} type="button" role="tab" id={`settings-tab-${t.id}`} aria-selected={on} aria-controls="settings-panel" title={t.label}
                onClick={() => setTab(t.id)}
                className={clsx(
                  'flex h-[38px] items-center gap-2.5 rounded-[9px] px-2.5 text-sm max-md:justify-center',
                  on ? 'bg-surface font-semibold text-text shadow-md' : 'font-medium text-text-2 hover:bg-bg-2 hover:text-text',
                )}
              >
                <t.icon size={18} aria-hidden className="flex-none" />
                <span className="flex-1 truncate text-left max-md:hidden">{t.label}</span>
                {count !== undefined && <span data-testid={`count-${t.id}`} className="font-mono text-xs text-text-3 max-md:hidden">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <span aria-hidden className="grid h-6 w-6 flex-none place-items-center rounded-full bg-bg-3 text-xs font-semibold">{name[0]!.toUpperCase()}</span>
          <span className="truncate text-sm text-text-2 max-md:hidden">{name}</span>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2.5 px-9 pb-[18px] pt-6">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-base font-semibold tracking-tight">{tab.title}</h1>
            <p className="m-0 mt-0.5 text-sm leading-normal text-text-3">{tab.sub}</p>
          </div>
          <div ref={setActions} className="flex items-center gap-2" />
          <button
            type="button" aria-label="Close settings" title="Back to app (Esc)" onClick={close}
            className="flex h-8 flex-none items-center gap-1.5 rounded-lg border border-rule-2 px-2.5 text-sm text-text-2 hover:bg-bg-2 hover:text-text"
          >
            <ArrowLeft size={14} aria-hidden />Back to app
          </button>
        </header>
        <div className="h-px bg-rule" />
        {/* The scroller and the overlay slot are siblings, so a full-page detail never scrolls with the list under it. */}
        <div role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab.id}`} className="relative min-h-0 flex-1">
          <div className="absolute inset-0 overflow-y-auto">
            <HeaderSlot.Provider value={actions}>
              <OverlaySlot.Provider value={overlay}>{PANELS[tab.id]()}</OverlaySlot.Provider>
            </HeaderSlot.Provider>
          </div>
          <div ref={setOverlay} />
        </div>
      </div>
    </div>
  );
}
