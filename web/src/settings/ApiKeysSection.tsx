import { useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { maskKey } from '../lib/api-keys';
import { toast } from '../ui/toast';
import { PROVIDERS, providerLabel } from './options';
import { toolStatuses } from './tool-status';
import { INPUT, Section } from './fields';

export function ApiKeysSection() {
  const apiKeys = useAppStore(s => s.apiKeys);
  const searxngUrl = useAppStore(s => s.prefs.searxngUrl);
  const connect = useAppStore(s => s.connectApiKey);
  const disconnect = useAppStore(s => s.disconnectApiKey);
  const [provider, setProvider] = useState('anthropic');
  const [draft, setDraft] = useState('');

  const entries = Object.entries(apiKeys);
  const tools = toolStatuses({ apiKeys, searxngUrl });

  const submit = (): void => {
    if (!draft.trim()) return;
    connect(provider, draft);
    setDraft('');
    toast('API key connected');
  };

  return (
    <Section
      label="API Keys"
      help="Stored locally in your browser. Keys are only sent to their respective APIs (Anthropic, Serper, Firecrawl, etc.)."
    >
      <div className="mb-2.5">
        {entries.length === 0 && <p className="m-0 text-xs text-text-3">No keys connected yet.</p>}
        {entries.map(([id, key]) => (
          <div key={id} className="flex items-center gap-2.5 border-b border-rule py-1.5 text-sm">
            <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-branch" />
            <span className="text-text">{providerLabel(id)}</span>
            <span className="ml-auto font-mono text-xs text-text-3" data-testid={`key-mask-${id}`}>{maskKey(key)}</span>
            <button
              type="button" title="Disconnect" aria-label={`Disconnect ${providerLabel(id)}`}
              onClick={() => disconnect(id)}
              className="grid h-6 w-6 place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <select aria-label="Provider" className={`${INPUT} mb-1.5`} value={provider} onChange={e => setProvider(e.target.value)}>
        {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.option}</option>)}
      </select>
      <div className="flex gap-1.5">
        <input
          className={INPUT} type="password" aria-label="API key" placeholder="Paste API key…" autoComplete="off"
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <button
          type="button" onClick={submit}
          className="flex-none rounded-md border border-rule-2 bg-bg-2 px-3 text-sm font-medium text-text hover:bg-bg-3"
        >
          Connect
        </button>
      </div>

      <div className="mt-3.5 rounded-lg border border-rule bg-surface-2 px-3 py-2.5">
        <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-text-3">Tools the model can use</div>
        <ul className="m-0 list-none p-0" aria-label="Tool availability">
          {tools.map(t => (
            <li key={t.name} data-tool={t.name} data-on={t.on} className="flex items-center gap-2 py-0.5 text-sm">
              <span aria-hidden className={t.on ? 'h-1.5 w-1.5 rounded-full bg-branch' : 'h-1.5 w-1.5 rounded-full bg-text-3'} />
              <span className={t.on ? 'text-text' : 'text-text-3'}>{t.label}</span>
              <span className="ml-auto text-xs text-text-3">{t.on ? 'on' : `needs ${t.needs}`}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
