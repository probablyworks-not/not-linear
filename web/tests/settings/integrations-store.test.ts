import { beforeEach, describe, expect, it } from 'vitest';
import {
  INTEGRATIONS_STORAGE, NOT_CONFIGURED, integrationCount, mcpTransport, parseIntegrations, useIntegrationsStore,
} from '../../src/settings/integrations-store';

const reset = (): void => useIntegrationsStore.setState({ apps: {}, mcps: [], plugins: {} });

describe('parseIntegrations', () => {
  it('falls back to the empty state for anything unreadable, without throwing', () => {
    for (const raw of [null, '', 'nope', '[]', '123', '{"apps":5,"mcps":"x","plugins":[]}']) {
      expect(parseIntegrations(raw)).toEqual({ apps: {}, mcps: [], plugins: {} });
    }
  });
  it('drops malformed servers but keeps good ones', () => {
    const good = { id: 'a', name: 'Fetch', command: 'uvx mcp-server-fetch', on: true };
    const out = parseIntegrations(JSON.stringify({ mcps: [good, { id: 1 }, null, 'x'] }));
    expect(out.mcps).toEqual([good]);
  });
});

describe('mcpTransport', () => {
  it('tells a URL from a command, and says nothing for an unconfigured server', () => {
    expect(mcpTransport('https://x.dev/mcp')).toBe('http');
    expect(mcpTransport('npx -y @modelcontextprotocol/server-fetch')).toBe('stdio');
    expect(mcpTransport(NOT_CONFIGURED)).toBeNull();
    expect(mcpTransport('')).toBeNull();
  });
});

describe('the store', () => {
  beforeEach(() => { reset(); localStorage.clear(); });

  it('ignores a server with a blank name, and saves a blank command as "not configured" with 0 servers added otherwise', () => {
    const s = useIntegrationsStore.getState();
    expect(s.addMcp('   ', 'x')).toBe(false);
    expect(useIntegrationsStore.getState().mcps).toHaveLength(0);
    expect(s.addMcp(' Fetch ', '  ')).toBe(true);
    const [m] = useIntegrationsStore.getState().mcps;
    expect(m).toMatchObject({ name: 'Fetch', command: NOT_CONFIGURED, on: true });
  });

  it('toggles and removes servers, and gives each a distinct id', () => {
    const s = useIntegrationsStore.getState();
    s.addMcp('A', 'a'); s.addMcp('B', 'b');
    const [a, b] = useIntegrationsStore.getState().mcps;
    expect(a!.id).not.toBe(b!.id);
    useIntegrationsStore.getState().toggleMcp(a!.id);
    expect(useIntegrationsStore.getState().mcps[0]!.on).toBe(false);
    useIntegrationsStore.getState().removeMcp(a!.id);
    expect(useIntegrationsStore.getState().mcps.map(m => m.name)).toEqual(['B']);
  });

  it('persists to its own localStorage key and counts connected apps plus enabled servers', () => {
    const s = useIntegrationsStore.getState();
    s.setApp('github', true); s.addMcp('A', 'a'); s.addMcp('B', 'b');
    useIntegrationsStore.getState().toggleMcp(useIntegrationsStore.getState().mcps[1]!.id);
    expect(integrationCount(useIntegrationsStore.getState())).toBe(2); // github + A (B is off)
    expect(parseIntegrations(localStorage.getItem(INTEGRATIONS_STORAGE))).toMatchObject({ apps: { github: true } });
  });
});
