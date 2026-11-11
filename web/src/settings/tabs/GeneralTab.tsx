import { useState } from 'react';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../state/app-store';
import { THEMES, TONES } from '../options';
import { INPUT, Section, Segmented } from '../fields';
import { Toggle, PageBody } from '../ui';
import { flags } from '../../flags';
import { getClarifyFirst, setClarifyFirst } from '../../chat/clarify-pref';

/**
 * General: how the app looks and who it is talking to. Typed fields keep a local draft so the input
 * never fights the store (clearing the workspace name stores 'Workspace', as legacy does, but the
 * box stays empty while the user types). The store gets every keystroke; the database gets one
 * debounced write.
 */
export function GeneralTab() {
  const prefs = useAppStore(s => s.prefs);
  const setPref = useAppStore(s => s.setPref);
  const flushPrefs = useAppStore(s => s.flushPrefs);

  const [folder, setFolder] = useState(prefs.folderName || 'Workspace');
  const [name, setName] = useState(prefs.name || '');
  const [context, setContext] = useState(prefs.context || '');
  const blur = (): void => { void flushPrefs(); };

  return (
    <PageBody>
      <Section label="Appearance"><ThemeCards /></Section>

      <div className="grid gap-x-8 md:grid-cols-2">
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
      </div>

      <Section label="Tone preset" help="Applied to every AI reply across the main thread and branches.">
        <Segmented label="Tone" value={prefs.tone || 'concise'} choices={TONES} onChange={id => { void setPref('tone', id); }} />
      </Section>

      <Section label="What are you working on?" help="Shared with the model so replies fit your context.">
        <textarea
          className={`${INPUT} min-h-[84px] resize-y`} aria-label="What you are working on" value={context} onBlur={blur}
          onChange={e => { setContext(e.target.value); void setPref('context', e.target.value, { debounce: true }); }}
        />
      </Section>

      {flags.clarify && <ClarifyFirst />}
    </PageBody>
  );
}

function ThemeCards() {
  const theme = useAppStore(s => s.prefs.theme) || 'light';
  const setTheme = useAppStore(s => s.setTheme);
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      {THEMES.map(t => {
        const on = t.id === theme;
        return (
          <button
            key={t.id} type="button" role="radio" aria-checked={on} onClick={() => { void setTheme(t.id); }}
            className={clsx(
              'flex flex-col rounded-[14px] border bg-surface p-2 text-left transition-shadow duration-150',
              on ? 'border-text-2 shadow-md' : 'border-rule hover:border-rule-2',
            )}
          >
            {/* The preview re-declares the theme's tokens on itself, so each card shows its own palette whatever is applied. */}
            <div data-preview-theme={t.id} aria-hidden className="flex h-[110px] overflow-hidden rounded-[9px] border border-rule bg-bg">
              <div className="w-[30%] bg-surface-2" />
              <div className="flex flex-1 flex-col gap-1.5 px-2.5 py-3">
                <div className="h-1.5 w-3/5 rounded-sm bg-rule-2" />
                <div className="h-1.5 w-[85%] rounded-sm bg-rule-2" />
                <div className="h-1.5 w-2/5 rounded-sm bg-rule-2" />
                <div className="flex-1" />
                <div className="h-4 rounded-md bg-bg-3" />
              </div>
            </div>
            <div className="flex items-center gap-2 px-1 pb-0.5 pt-3">
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-text">{t.label}</div>
                <div className="text-xs text-text-3">{t.blurb}</div>
              </div>
              <span aria-hidden className={clsx('grid h-[18px] w-[18px] place-items-center rounded-full border', on ? 'border-text bg-text text-bg' : 'border-rule-2')}>
                {on && <Check size={12} strokeWidth={3} />}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ClarifyFirst() {
  const [on, setOn] = useState(getClarifyFirst);
  return (
    <Section label="Clarify intent first" help="Before answering, the model may ask a few quick questions when your message is ambiguous, then uses your answers to shape the reply. Clear messages are answered straight away. Works with every model.">
      <div className="flex items-center justify-between gap-2.5">
        <span className="text-sm text-text-2">Ask clarifying questions</span>
        <Toggle on={on} label="Clarify intent first" onChange={next => { setClarifyFirst(next); setOn(next); }} />
      </div>
    </Section>
  );
}
