import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { MODELS, RANKING_OPTIONS, THEMES, TONES } from './options';
import { INPUT, Section, Segmented } from './fields';
import { ApiKeysSection } from './ApiKeysSection';
import { flags } from '../flags';
import { ChangelogSection } from '../changelog/ChangelogSection';
import { FeedbackLog } from '../feedback/FeedbackLog';
import { RuntimeLogs } from './RuntimeLogs';
import { getClarifyFirst, setClarifyFirst } from '../chat/clarify-pref';

/**
 * Ports the Settings panel (index.html #prefs, app.js:4287). Defaults shown
 * when a pref was never saved match the ones legacy shows.
 *
 * Typed fields keep a local draft so the input never fights the store (legacy
 * stores 'Workspace' the moment the folder field is cleared; a controlled
 * input bound to that would snap back mid-edit). The store gets every
 * keystroke, the database gets one debounced write.
 */
export function SettingsDialog() {
  const open = useUiStore(s => s.settingsOpen);
  const setOpen = useUiStore(s => s.setSettingsOpen);
  const flushPrefs = useAppStore(s => s.flushPrefs);

  const close = (): void => { setOpen(false); void flushPrefs(); };
  useEscLayer('prefs', ESC_PRIORITY.prefs, open, close);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[300] bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[301] flex max-h-[82vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[14px] border border-rule bg-surface shadow-lg"
        >
          <div className="flex items-center gap-2.5 border-b border-rule px-[18px] py-4">
            <Dialog.Title className="m-0 flex-1 text-base font-semibold">Settings</Dialog.Title>
            <button
              type="button" aria-label="Close settings" onClick={close}
              className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text"
            >
              <X size={15} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-[18px]">
            <SettingsForm />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted only while the dialog is open, so drafts initialise from the current prefs each time. */
function SettingsForm() {
  const prefs = useAppStore(s => s.prefs);
  const setPref = useAppStore(s => s.setPref);
  const setTheme = useAppStore(s => s.setTheme);
  const flushPrefs = useAppStore(s => s.flushPrefs);
  const setModesOpen = useUiStore(s => s.setModesOpen);
  const setSkillsOpen = useUiStore(s => s.setSkillsOpen);

  const [folder, setFolder] = useState(prefs.folderName || 'Workspace');
  const [name, setName] = useState(prefs.name || '');
  const [context, setContext] = useState(prefs.context || '');
  const [searxng, setSearxng] = useState(prefs.searxngUrl || '');

  const blur = (): void => { void flushPrefs(); };

  return (
    <>
      <Section label="Appearance">
        <Segmented label="Theme" value={prefs.theme || 'light'} choices={THEMES} onChange={id => { void setTheme(id); }} />
      </Section>

      <Section label="Workspace name">
        <input
          className={INPUT} aria-label="Workspace name" value={folder} onBlur={blur}
          onChange={e => { setFolder(e.target.value); void setPref('folderName', e.target.value || 'Workspace', { debounce: true }); }}
        />
      </Section>

      <Section label="What should AI call you?">
        <input
          className={INPUT} aria-label="Your name" value={name} onBlur={blur}
          onChange={e => { setName(e.target.value); void setPref('name', e.target.value, { debounce: true }); }}
        />
      </Section>

      <Section label="Tone preset" help="Applied to every AI reply across the main thread and branches.">
        <Segmented label="Tone" value={prefs.tone || 'concise'} choices={TONES} onChange={id => { void setPref('tone', id); }} />
      </Section>

      <Section label="What are you working on?">
        <textarea
          className={`${INPUT} min-h-[84px] resize-y`} aria-label="What you are working on" value={context} onBlur={blur}
          onChange={e => { setContext(e.target.value); void setPref('context', e.target.value, { debounce: true }); }}
        />
      </Section>

      <Section label="Default model">
        <Segmented label="Default model" value={prefs.model || 'sonnet'} choices={MODELS} columns={2} onChange={id => { void setPref('model', id); }} />
      </Section>

      {flags.clarify && <ClarifyFirstSection />}

      {flags.modes && (
        <Section label="Conversation modes" help="Instructions added to the system prompt. Applies to every chat. Picking the active mode lives in the composer.">
          <button
            type="button" onClick={() => setModesOpen(true)}
            className="w-full rounded-md border border-rule-2 bg-surface px-3 py-2 text-left text-sm text-text-2 hover:border-text-2 hover:bg-bg-2 hover:text-text"
          >
            New / manage modes
          </button>
        </Section>
      )}

      {flags.skills && (
        <Section label="Skills" help="Reusable methods (pre-mortem, steelman, research playbooks…) added to the system prompt. Picked automatically per message from each skill's description and keywords; works with any model.">
          <button
            type="button" onClick={() => setSkillsOpen(true)}
            className="w-full rounded-md border border-rule-2 bg-surface px-3 py-2 text-left text-sm text-text-2 hover:border-text-2 hover:bg-bg-2 hover:text-text"
          >
            Browse / edit skills
          </button>
        </Section>
      )}

      <ApiKeysSection />

      <Section
        label="Context Ranking"
        help="Controls how files are selected when chatting in a project with a linked folder. DeepSeek requires a DeepSeek API key."
      >
        <select
          className={INPUT} aria-label="Context ranking" value={prefs.rankingLlm || 'none'}
          onChange={e => { void setPref('rankingLlm', e.target.value); }}
        >
          {RANKING_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Section>

      <Section
        label="Web Search (SearXNG)"
        help={<>URL of your SearXNG instance. Must have CORS enabled (<code>cors: true</code> in settings.yml). Leave blank to disable web search.</>}
      >
        <input
          className={INPUT} type="url" aria-label="SearXNG URL" placeholder="http://localhost:8888" autoComplete="off"
          value={searxng} onBlur={blur}
          onChange={e => { setSearxng(e.target.value); void setPref('searxngUrl', e.target.value.trim(), { debounce: true }); }}
        />
      </Section>

      {flags.changelog && <ChangelogSection />}

      {flags.feedback && <FeedbackLog />}

      {flags.logs && <RuntimeLogs />}
    </>
  );
}

function ClarifyFirstSection() {
  const [on, setOn] = useState(getClarifyFirst);
  const toggle = (): void => { setClarifyFirst(!on); setOn(!on); };
  return (
    <Section label="Clarify intent first" help="Before answering, the model may ask a few quick questions when your message is ambiguous, then uses your answers to shape the reply. Clear messages are answered straight away. Works with every model.">
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-sm text-text-2">Ask clarifying questions</span>
        <button
          type="button" role="switch" aria-checked={on} aria-label="Clarify intent first" onClick={toggle}
          className={`relative h-[18px] w-8 flex-none rounded-full border transition-colors ${on ? 'border-accent bg-accent' : 'border-rule bg-bg-3'}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-bg shadow-md transition-transform ${on ? 'translate-x-3.5' : ''}`} />
        </button>
      </div>
    </Section>
  );
}
