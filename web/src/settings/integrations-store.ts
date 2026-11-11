import { create } from 'zustand';

// PLACEHOLDER (Settings -> Integrations). Nothing here talks to GitHub, Reddit, an MCP server or a
// plugin runtime: it remembers what the user clicked so the screen can be reviewed and the zero
// states exercised. When a real integration lands it replaces its slice of this store. Kept in
// localStorage, apart from the chat database, so a placeholder never touches real data.

export const INTEGRATIONS_STORAGE = 'nl_integrations_preview_v1';

export interface AppDef { id: string; name: string; account: string | null; offer: string; scopes: string[] }
export const APPS: readonly AppDef[] = [
  { id: 'github', name: 'GitHub', account: null, offer: 'Repos, issues and pull requests', scopes: ['Read repos', 'Issues', 'Pull requests', 'Code search'] },
  { id: 'reddit', name: 'Reddit', account: null, offer: 'Threads and community research', scopes: ['Read posts', 'Comments', 'Subreddit search'] },
  { id: 'notion', name: 'Notion', account: null, offer: 'Pages and databases', scopes: ['Read pages', 'Create pages'] },
  { id: 'drive', name: 'Google Drive', account: null, offer: 'Docs, sheets and files', scopes: ['Read files', 'Search'] },
  { id: 'slack', name: 'Slack', account: null, offer: 'Channels and messages', scopes: ['Read channels', 'Post messages'] },
];

export interface PluginDef { id: string; name: string; desc: string; defaultOn: boolean }
export const PLUGINS: readonly PluginDef[] = [
  { id: 'wikipedia', name: 'Wikipedia search', desc: 'Look up facts and summaries.', defaultOn: true },
  { id: 'web-search', name: 'Web search', desc: 'Uses your Serper key or SearXNG URL.', defaultOn: true },
  { id: 'fetch-page', name: 'Fetch a web page', desc: 'Read the text of any URL.', defaultOn: true },
  { id: 'save-notes', name: 'Save answers as notes', desc: 'Long replies become notes.', defaultOn: false },
];

export interface McpServer { id: string; name: string; command: string; on: boolean }
export const NOT_CONFIGURED = 'not configured';

/** HTTP when it looks like a URL, otherwise a command to spawn. Display only for now. */
export function mcpTransport(command: string): 'http' | 'stdio' | null {
  if (!command || command === NOT_CONFIGURED) return null;
  return /^https?:\/\//i.test(command) ? 'http' : 'stdio';
}

interface Persisted { apps: Record<string, boolean>; mcps: McpServer[]; plugins: Record<string, boolean> }

const EMPTY: Persisted = { apps: {}, mcps: [], plugins: {} };

const isRecordOfBool = (v: unknown): v is Record<string, boolean> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'boolean');
const isServer = (v: unknown): v is McpServer => {
  const s = v as Partial<McpServer> | null;
  return !!s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.command === 'string' && typeof s.on === 'boolean';
};

/** Tolerates anything: a hand-edited or older value falls back to the empty state, never throws. */
export function parseIntegrations(raw: string | null): Persisted {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<Persisted> | null;
    if (!v || typeof v !== 'object') return EMPTY;
    return {
      apps: isRecordOfBool(v.apps) ? v.apps : {},
      mcps: Array.isArray(v.mcps) ? v.mcps.filter(isServer) : [],
      plugins: isRecordOfBool(v.plugins) ? v.plugins : {},
    };
  } catch {
    return EMPTY;
  }
}

function load(): Persisted {
  try { return parseIntegrations(localStorage.getItem(INTEGRATIONS_STORAGE)); } catch { return EMPTY; }
}
function save(s: Persisted): void {
  try { localStorage.setItem(INTEGRATIONS_STORAGE, JSON.stringify({ apps: s.apps, mcps: s.mcps, plugins: s.plugins })); } catch { /* blocked storage: the change lasts until reload */ }
}

interface IntegrationsState extends Persisted {
  setApp(id: string, connected: boolean): void;
  /** Returns false (and adds nothing) when the name is blank. A blank command is saved as "not configured". */
  addMcp(name: string, command: string): boolean;
  toggleMcp(id: string): void;
  removeMcp(id: string): void;
  setPlugin(id: string, on: boolean): void;
}

let seq = 0;

export const useIntegrationsStore = create<IntegrationsState>((set, get) => {
  const commit = (patch: Partial<Persisted>): void => {
    const next = { apps: get().apps, mcps: get().mcps, plugins: get().plugins, ...patch };
    set(patch);
    save(next);
  };
  return {
    ...load(),
    setApp(id, connected) { commit({ apps: { ...get().apps, [id]: connected } }); },
    addMcp(name, command) {
      const n = name.trim();
      if (!n) return false;
      commit({ mcps: [...get().mcps, { id: `mcp-${Date.now().toString(36)}-${++seq}`, name: n, command: command.trim() || NOT_CONFIGURED, on: true }] });
      return true;
    },
    toggleMcp(id) { commit({ mcps: get().mcps.map(m => (m.id === id ? { ...m, on: !m.on } : m)) }); },
    removeMcp(id) { commit({ mcps: get().mcps.filter(m => m.id !== id) }); },
    setPlugin(id, on) { commit({ plugins: { ...get().plugins, [id]: on } }); },
  };
});

export const pluginOn = (plugins: Record<string, boolean>, def: PluginDef): boolean => plugins[def.id] ?? def.defaultOn;

/** Rail count: connected apps plus enabled MCP servers. */
export function integrationCount(s: Pick<Persisted, 'apps' | 'mcps'>): number {
  return Object.values(s.apps).filter(Boolean).length + s.mcps.filter(m => m.on).length;
}
