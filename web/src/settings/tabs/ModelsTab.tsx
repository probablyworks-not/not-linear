import { useState } from 'react';
import { Lock } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../state/app-store';
import { useUiStore } from '../../state/ui-store';
import { maskKey } from '../../lib/api-keys';
import { toast } from '../../ui/toast';
import { MODELS, RANKING_OPTIONS, providerLabel } from '../options';
import { toolStatuses } from '../tool-status';
import { INPUT, Section, Segmented } from '../fields';
import { BTN_DANGER, BTN_PRIMARY, PageBody, Pill } from '../ui';

interface Card { id: string; name: string; sub: string; kind: 'key' | 'url' }

const GROUPS: ReadonlyArray<{ title: string; cards: readonly Card[] }> = [
  {
    title: 'Models',
    cards: [
      { id: 'anthropic', name: 'Anthropic', sub: 'Claude Opus, Sonnet, Haiku', kind: 'key' },
      { id: 'openai', name: 'OpenAI', sub: 'GPT models', kind: 'key' },
      { id: 'deepseek', name: 'DeepSeek', sub: 'Chat, reasoning and context ranking', kind: 'key' },
      { id: 'gemini', name: 'Google', sub: 'Gemini models', kind: 'key' },
      { id: 'custom', name: 'Other', sub: 'Any other provider key', kind: 'key' },
    ],
  },
  {
    title: 'Search & tools',
    cards: [
      { id: 'serper', name: 'Serper', sub: 'Web search', kind: 'key' },
      { id: 'firecrawl', name: 'Firecrawl', sub: 'Web scrape', kind: 'key' },
      { id: 'searxng', name: 'SearXNG', sub: 'Self-hosted search URL', kind: 'url' },
      { id: 'github', name: 'GitHub', sub: 'Token for repo and code research', kind: 'key' },
    ],
  },
  {
    title: 'Voice',
    cards: [
      { id: 'assemblyai', name: 'AssemblyAI', sub: 'Live speech-to-text for the mic button', kind: 'key' },
    ],
  },
];

/** Only http(s) URLs are saved: anything else would make the search tool fail at call time. */
export const isHttpUrl = (v: string): boolean => /^https?:\/\/\S+$/i.test(v);

export function ModelsTab() {
  const apiKeys = useAppStore(s => s.apiKeys);
  const searxngUrl = useAppStore(s => s.prefs.searxngUrl);
  const model = useAppStore(s => s.prefs.model);
  const rankingLlm = useAppStore(s => s.prefs.rankingLlm);
  const setPref = useAppStore(s => s.setPref);
  const [open, setOpen] = useState<string | null>(null);

  const tools = toolStatuses({ apiKeys, searxngUrl });

  return (
    <PageBody>
      <Section label="Default model" help="Used for new chats. You can switch per chat from the composer.">
        <Segmented label="Default model" value={model || 'sonnet'} choices={MODELS} columns={2} onChange={id => { void setPref('model', id); }} />
      </Section>

      {GROUPS.map(g => (
        <Section key={g.title} label={g.title}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] items-start gap-3">
            {g.cards.map(c => (
              <ProviderCard
                key={c.id} card={c} open={open === c.id}
                connected={c.kind === 'url' ? !!searxngUrl : c.id in apiKeys}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
              />
            ))}
          </div>
        </Section>
      ))}

      <Section label="Tools the model can use" help="Switch on automatically once the key or URL they need is set.">
        <ul className="m-0 list-none rounded-xl border border-rule bg-surface-2 p-3" aria-label="Tool availability">
          {tools.map(t => (
            <li key={t.name} data-tool={t.name} data-on={t.on} className="flex items-center gap-2 py-0.5 text-sm">
              <span aria-hidden className={t.on ? 'h-1.5 w-1.5 rounded-full bg-success' : 'h-1.5 w-1.5 rounded-full bg-text-3'} />
              <span className={t.on ? 'text-text' : 'text-text-3'}>{t.label}</span>
              <span className="ml-auto text-xs text-text-3">{t.on ? 'on' : `needs ${t.needs}`}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        label="Context Ranking"
        help="Controls how files are selected when chatting in a project with a linked folder. DeepSeek requires a DeepSeek API key."
      >
        <select
          className={INPUT} aria-label="Context ranking" value={rankingLlm || 'none'}
          onChange={e => { void setPref('rankingLlm', e.target.value); }}
        >
          {RANKING_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Section>
    </PageBody>
  );
}

function ProviderCard({ card, open, connected, onToggle }: { card: Card; open: boolean; connected: boolean; onToggle(): void }) {
  return (
    <div data-provider={card.id} className={clsx('rounded-[14px] border bg-surface p-3.5 transition-colors duration-150', open ? 'border-text' : 'border-rule')}>
      <button type="button" aria-expanded={open} aria-label={`${card.name} settings`} onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span aria-hidden className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[10px] bg-bg-3 text-base font-semibold text-text">{card.name[0]}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-text">{card.name}</span>
          <span className="block text-xs leading-snug text-text-3">{card.sub}</span>
        </span>
        <Pill on={connected}>{connected ? 'Connected' : 'Not set'}</Pill>
      </button>
      {open && (
        <div className="mt-3.5 border-t border-rule pt-3.5">
          {card.kind === 'url' ? <SearxngBody connected={connected} /> : <KeyBody card={card} connected={connected} />}
        </div>
      )}
    </div>
  );
}

function KeyBody({ card, connected }: { card: Card; connected: boolean }) {
  const key = useAppStore(s => s.apiKeys[card.id]);
  const connect = useAppStore(s => s.connectApiKey);
  const disconnect = useAppStore(s => s.disconnectApiKey);
  const askConfirm = useUiStore(s => s.askConfirm);
  const [draft, setDraft] = useState('');

  const submit = (): void => {
    if (!draft.trim()) return;
    connect(card.id, draft);
    setDraft('');
    toast('API key connected');
  };
  const remove = async (): Promise<void> => {
    const ok = await askConfirm({
      heading: 'Remove API key?', name: providerLabel(card.id), before: 'This removes the key for',
      after: ' from this device. Anything that needs it stops working until you add it again.', actionLabel: 'Remove key',
    });
    if (!ok) return;
    disconnect(card.id);
    toast('API key removed');
  };

  if (connected && key) {
    return (
      <div className="flex items-center gap-2">
        <div data-testid={`key-mask-${card.id}`} className="flex h-9 min-w-0 flex-1 items-center truncate rounded-[9px] bg-bg-2 px-3 font-mono text-xs text-text-2">{maskKey(key)}</div>
        <button type="button" aria-label={`Remove ${card.name} key`} className={clsx(BTN_DANGER, 'h-9')} onClick={() => { void remove(); }}>Remove</button>
      </div>
    );
  }
  return (
    <>
      <div className="flex gap-2">
        <input
          className={clsx(INPUT, 'h-9')} type="password" aria-label={`${card.name} API key`} placeholder="Paste API key…" autoComplete="off"
          value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <button type="button" className={clsx(BTN_PRIMARY, 'h-9')} onClick={submit}>Connect</button>
      </div>
      <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-text-3">
        <Lock size={12} aria-hidden />Stored locally. Never leaves your device except to {card.name}.
      </p>
    </>
  );
}

function SearxngBody({ connected }: { connected: boolean }) {
  const saved = useAppStore(s => s.prefs.searxngUrl) || '';
  const setPref = useAppStore(s => s.setPref);
  const flushPrefs = useAppStore(s => s.flushPrefs);
  const askConfirm = useUiStore(s => s.askConfirm);
  const [draft, setDraft] = useState(saved);
  const trimmed = draft.trim();
  const invalid = trimmed !== '' && !isHttpUrl(trimmed);

  const change = (v: string): void => {
    setDraft(v);
    const t = v.trim();
    if (t === '' || isHttpUrl(t)) void setPref('searxngUrl', t, { debounce: true });
  };
  const remove = async (): Promise<void> => {
    const ok = await askConfirm({
      heading: 'Remove SearXNG URL?', name: saved, before: 'Web search through', after: ' stops until you add a URL again.', actionLabel: 'Remove URL',
    });
    if (!ok) return;
    setDraft('');
    await setPref('searxngUrl', '');
    toast('SearXNG URL removed');
  };

  return (
    <>
      <div className="flex gap-2">
        <input
          className={clsx(INPUT, 'h-9')} type="url" aria-label="SearXNG URL" placeholder="http://localhost:8888" autoComplete="off"
          aria-invalid={invalid} value={draft} onBlur={() => { void flushPrefs(); }} onChange={e => change(e.target.value)}
        />
        {connected && <button type="button" aria-label="Remove SearXNG URL" className={clsx(BTN_DANGER, 'h-9')} onClick={() => { void remove(); }}>Remove</button>}
      </div>
      {invalid && <p role="alert" className="m-0 mt-2 text-xs text-danger">Enter a full URL, like http://localhost:8888. It is not saved until it is valid.</p>}
      <p className="m-0 mt-2 text-xs leading-normal text-text-3">
        Your SearXNG instance needs CORS enabled (<code>cors: true</code> in settings.yml). Leave blank to turn web search off.
      </p>
    </>
  );
}
