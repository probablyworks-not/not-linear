import { useState } from 'react';
import { Plus, Server, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../../state/app-store';
import { useUiStore } from '../../state/ui-store';
import { toast } from '../../ui/toast';
import {
  APPS, PLUGINS, mcpTransport, pluginOn, useIntegrationsStore, type AppDef, type McpServer,
} from '../integrations-store';
import { INPUT } from '../fields';
import { BTN, BTN_PRIMARY, EmptyState, PageBody, Pill, PreviewBadge, SubTabs, Toggle } from '../ui';

type Sub = 'apps' | 'mcp' | 'plugins';

const ROW = 'flex items-center gap-4 px-[18px] py-4';
const LIST = 'divide-y divide-rule overflow-hidden rounded-[14px] border border-rule';
const TILE = 'grid h-[42px] w-[42px] flex-none place-items-center rounded-[11px] bg-bg-2 text-base font-semibold text-text-2';

/**
 * Apps, MCP servers and plugins. PREVIEW: the controls remember a choice on this device and nothing
 * more (see integrations-store.ts). The banner says so, so nobody mistakes a click for a connection.
 */
export function IntegrationsTab() {
  const { apps, mcps, plugins } = useIntegrationsStore();
  const [sub, setSub] = useState<Sub>('apps');
  const [adding, setAdding] = useState(false);

  return (
    <PageBody>
      <div role="note" className="mb-5 flex items-center gap-2.5 rounded-xl border border-rule bg-surface-2 px-3.5 py-2.5 text-sm text-text-2">
        <PreviewBadge />
        <span>These connections are not live yet. Your choices are saved on this device so you can try the flow.</span>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <SubTabs<Sub>
          label="Integrations" value={sub} onChange={setSub}
          items={[
            { id: 'apps', label: 'Apps', count: APPS.length },
            { id: 'mcp', label: 'MCP servers', count: mcps.length },
            { id: 'plugins', label: 'Plugins', count: PLUGINS.length },
          ]}
        />
        <div className="flex-1" />
        {sub === 'mcp' && <button type="button" className={BTN_PRIMARY} onClick={() => setAdding(a => !a)}><Plus size={14} aria-hidden />Add server</button>}
      </div>

      {sub === 'apps' && (
        <ul className={clsx(LIST, 'm-0 list-none p-0')} aria-label="Apps">
          {APPS.map(a => <AppRow key={a.id} app={a} connected={!!apps[a.id]} />)}
        </ul>
      )}
      {sub === 'mcp' && <McpPanel showForm={adding} onDone={() => setAdding(false)} />}
      {sub === 'plugins' && (
        <ul className={clsx(LIST, 'm-0 list-none p-0')} aria-label="Plugins">
          {PLUGINS.map(p => (
            <PluginRow key={p.id} id={p.id} name={p.name} desc={p.desc} on={pluginOn(plugins, p)} />
          ))}
        </ul>
      )}
    </PageBody>
  );
}

function AppRow({ app, connected }: { app: AppDef; connected: boolean }) {
  const setApp = useIntegrationsStore(s => s.setApp);
  const setTab = useUiStore(s => s.setSettingsTab);
  return (
    <li data-app={app.id} data-connected={connected} className={ROW}>
      <span aria-hidden className={TILE}>{app.name[0]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-semibold text-text">{app.name}</span>
          <Pill on={connected}>{connected ? 'Connected' : 'Not connected'}</Pill>
        </div>
        <div className="mt-0.5 text-sm text-text-2">{connected ? 'Connected (preview)' : app.offer}</div>
        <div className="mt-1 text-xs text-text-3">{app.scopes.join(' · ')}</div>
        {app.id === 'github' && (
          <div className="mt-1 text-xs text-text-3">
            To use GitHub search in chat today, add a token under{' '}
            <button type="button" className="underline hover:text-text" onClick={() => setTab('models')}>Models & keys</button>.
          </div>
        )}
      </div>
      <button
        type="button" aria-label={`${connected ? 'Disconnect' : 'Connect'} ${app.name}`}
        className={connected ? BTN : BTN_PRIMARY} onClick={() => setApp(app.id, !connected)}
      >
        {connected ? 'Disconnect' : 'Connect'}
      </button>
    </li>
  );
}

function McpPanel({ showForm, onDone }: { showForm: boolean; onDone(): void }) {
  const mcps = useIntegrationsStore(s => s.mcps);
  const { addMcp, toggleMcp, removeMcp } = useIntegrationsStore();
  const askConfirm = useUiStore(s => s.askConfirm);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');

  const submit = (): void => {
    if (!addMcp(name, command)) { toast('Give the server a name'); return; }
    setName(''); setCommand(''); onDone();
    toast('Server added (preview)');
  };
  const remove = async (m: McpServer): Promise<void> => {
    const ok = await askConfirm({ heading: 'Delete MCP server?', name: m.name, before: 'This removes the server', after: ' from the list.', actionLabel: 'Delete server' });
    if (ok) removeMcp(m.id);
  };

  return (
    <>
      {showForm && (
        <div className="mb-3.5 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-2 rounded-xl border border-dashed border-rule-2 p-3.5">
          <input className={`${INPUT} h-9`} aria-label="Server name" placeholder="Name" value={name} autoFocus onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
          <input
            className={`${INPUT} h-9 font-mono`} aria-label="URL or command" placeholder="URL or command, e.g. npx -y @modelcontextprotocol/server-fetch"
            value={command} onChange={e => setCommand(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
          <button type="button" className={clsx(BTN_PRIMARY, 'h-9')} onClick={submit}>Add</button>
        </div>
      )}
      {mcps.length === 0 ? (
        !showForm && (
          <EmptyState icon={<Server size={18} />} title="No MCP servers">
            MCP servers give the assistant extra tools, like files or a database. Use Add server to register one by URL or command.
          </EmptyState>
        )
      ) : (
        <ul className={clsx(LIST, 'm-0 list-none p-0')} aria-label="MCP servers">
          {mcps.map(m => {
            const transport = mcpTransport(m.command);
            return (
              <li key={m.id} data-mcp={m.name} className={ROW}>
                <span aria-hidden className={TILE}><Server size={20} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="truncate text-base font-semibold text-text">{m.name}</span>
                    <Pill on={m.on}>{m.on ? 'Enabled' : 'Off'}</Pill>
                    {transport && <span className="rounded-md bg-bg-2 px-1.5 py-px font-mono text-xs uppercase text-text-3">{transport}</span>}
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-text-3">{m.command}</div>
                </div>
                <span className="whitespace-nowrap text-xs text-text-3">0 tools</span>
                <Toggle on={m.on} label={`Enable ${m.name}`} onChange={() => toggleMcp(m.id)} />
                <button type="button" aria-label={`Delete ${m.name}`} className="grid h-[30px] w-[30px] place-items-center rounded-lg text-text-3 hover:bg-danger-soft hover:text-danger" onClick={() => { void remove(m); }}><Trash2 size={15} /></button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function PluginRow({ id, name, desc, on }: { id: string; name: string; desc: string; on: boolean }) {
  const setPlugin = useIntegrationsStore(s => s.setPlugin);
  const setTab = useUiStore(s => s.setSettingsTab);
  const hasSearch = useAppStore(s => !!s.apiKeys.serper || !!s.prefs.searxngUrl);
  const warn = id === 'web-search' && on && !hasSearch;
  return (
    <li data-plugin={id} className={ROW}>
      <span aria-hidden className={TILE}>{name[0]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-text">{name}</div>
        <div className="mt-0.5 text-sm text-text-2">{desc}</div>
        {warn && (
          <div role="status" className="mt-1 text-xs text-highlight">
            No search key yet. Add a Serper key or SearXNG URL under{' '}
            <button type="button" className="underline" onClick={() => setTab('models')}>Models & keys</button>.
          </div>
        )}
      </div>
      <Toggle on={on} label={`Enable ${name}`} onChange={next => setPlugin(id, next)} />
    </li>
  );
}
