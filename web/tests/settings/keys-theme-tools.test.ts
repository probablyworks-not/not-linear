import { API_KEYS_STORAGE, connectKey, disconnectKey, maskKey, readApiKeys } from '../../src/lib/api-keys';
import { applyTheme, normalizeTheme } from '../../src/lib/theme';
import { toolStatuses } from '../../src/settings/tool-status';
import { TOOL_SPECS } from '../../src/providers/tool-specs';

// Obviously fake values. They are asserted on, so they must never be real keys.
const FAKE_A = 'sk-ant-TESTONLY-aaaaaaaaaaaa1234';
const FAKE_B = 'serper-TESTONLY-bbbbbbbb5678';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

describe('api keys (nl_api_keys, shared with legacy and notes.js)', () => {
  it('writes the flat { provider: key } shape notes.js parses', () => {
    connectKey('anthropic', FAKE_A);
    const raw = localStorage.getItem(API_KEYS_STORAGE)!;
    expect(JSON.parse(raw)).toEqual({ anthropic: FAKE_A });
    // The exact read notes.js:3101 does.
    expect(JSON.parse(localStorage.getItem('nl_api_keys') || '{}').anthropic).toBe(FAKE_A);
  });

  it('reads what legacy wrote', () => {
    localStorage.setItem(API_KEYS_STORAGE, JSON.stringify({ deepseek: FAKE_B }));
    expect(readApiKeys()).toEqual({ deepseek: FAKE_B });
  });

  it('trims, and ignores an empty key', () => {
    connectKey('serper', `  ${FAKE_B}  `);
    expect(readApiKeys().serper).toBe(FAKE_B);
    connectKey('openai', '   ');
    expect(readApiKeys().openai).toBeUndefined();
  });

  it('does not delete a key the other app added since we last looked', () => {
    // Simulates: web loaded with {}, legacy then connects anthropic, web connects serper.
    localStorage.setItem(API_KEYS_STORAGE, JSON.stringify({ anthropic: FAKE_A }));
    connectKey('serper', FAKE_B);
    expect(readApiKeys()).toEqual({ anthropic: FAKE_A, serper: FAKE_B });
    disconnectKey('serper');
    expect(readApiKeys()).toEqual({ anthropic: FAKE_A });
  });

  it.each([['not json'], ['null'], ['[]'], ['"str"'], ['{"a":1,"b":"ok"}']])('survives corrupt storage %j', raw => {
    localStorage.setItem(API_KEYS_STORAGE, raw);
    const keys = readApiKeys();
    expect(Object.values(keys).every(v => typeof v === 'string')).toBe(true);
  });

  it('masks like legacy: short keys reveal nothing, long keys show 4 + 4', () => {
    expect(maskKey('short')).toBe('••••••••');
    expect(maskKey(FAKE_A)).toBe('sk-a••••••••1234');
    expect(maskKey(FAKE_A)).not.toContain('TESTONLY');
  });

  it('never writes a key to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}));
    connectKey('anthropic', FAKE_A);
    readApiKeys();
    maskKey(FAKE_A);
    disconnectKey('anthropic');
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('TESTONLY');
    spies.forEach(s => s.mockRestore());
  });
});

describe('theme (prefs.theme and nl_theme must agree)', () => {
  it('dark removes the attribute, the others set it, and nl_theme follows', () => {
    applyTheme('grey');
    expect(document.documentElement.getAttribute('data-theme')).toBe('grey');
    expect(localStorage.getItem('nl_theme')).toBe('grey');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('nl_theme')).toBe('dark');
  });

  it('treats anything unknown as dark, as legacy does', () => {
    expect(normalizeTheme('purple')).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
  });
});

describe('tool availability', () => {
  const byName = (ctx: Parameters<typeof toolStatuses>[0]) => Object.fromEntries(toolStatuses(ctx).map(t => [t.name, t]));

  it('with nothing configured only the keyless tools are on, and the rest say what they need', () => {
    const t = byName({ apiKeys: {} });
    expect(t.wikipedia_search!.on).toBe(true);
    expect(t.fetch_url!.on).toBe(true);
    expect(t.serper_search).toMatchObject({ on: false, needs: 'a Serper key' });
    expect(t.firecrawl_scrape).toMatchObject({ on: false, needs: 'a Firecrawl key' });
    expect(t.web_search).toMatchObject({ on: false, needs: 'a SearXNG URL' });
  });

  it('turns on as soon as the key or URL exists', () => {
    const t = byName({ apiKeys: { serper: FAKE_B, firecrawl: FAKE_A }, searxngUrl: 'http://localhost:8888' });
    expect(Object.values(t).every(s => s.on)).toBe(true);
  });

  it('covers every tool in the registry, so adding a tool forces a label here', () => {
    expect(toolStatuses({ apiKeys: {} }).map(t => t.name)).toEqual(TOOL_SPECS.map(s => s.name));
  });
});
