import { fnSource } from '../helpers/legacy-source';
import { modeSystemPromptParts as legacyModeParts } from '../../../../frontend/core/modes.js';
import { appState as legacyState } from '../../../../frontend/core/state.js';
import { buildSystemPrompt } from '../../../src/chat/system-prompt';
import { buildAttachmentContext } from '../../../src/attachments/attachment-context';
import type { PersistedPrefs, PersistedProject } from '../../../src/db/types';

// The system prompt is the model's whole brief, so it is compared WHOLE with the real legacy
// function (cut out of app.js, with the helpers it calls) rather than spot-checked: a changed
// word here changes how the model behaves, in both apps, and nothing else would notice.

function legacyPrompt(prefs: PersistedPrefs, apiKeys: Record<string, string>, project: PersistedProject | null, extraContext = ''): string {
  legacyState.prefs = prefs as never; // modeSystemPromptParts reads the mode overrides from here
  const src = [
    'const ATTACHMENT_CONTEXT_CHAR_LIMIT = 70_000; const ATTACHMENT_FILE_CHAR_LIMIT = 30_000;',
    fnSource('fmtSize'), fnSource('safeFileAttr'), fnSource('buildAttachmentContext'), fnSource('buildSystemPrompt'),
    'return buildSystemPrompt;',
  ].join('\n');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function('apiKeys', 'prefs', 'getActiveProject', 'modeSystemPromptParts', src) as (...a: unknown[]) => (o: { extraContext: string }) => string;
  return make(apiKeys, prefs, () => project, (id: string) => legacyModeParts(id))({ extraContext });
}

const project = (over: Partial<PersistedProject> = {}): PersistedProject => ({ id: 'p1', name: 'Atlas', rules: '', files: [], path: '', ...over });

const CASES: Array<[string, PersistedPrefs, Record<string, string>, PersistedProject | null, string?]> = [
  ['a fresh install', {}, {}, null],
  ['name and context', { name: 'Yash', context: 'a research tool' }, {}, null],
  ['every tone', { tone: 'socratic' }, {}, null],
  ['technical tone', { tone: 'technical' }, {}, null],
  ['an unknown tone falls back to concise', { tone: 'chaotic' }, {}, null],
  ['research mode', { mode: 'research' }, {}, null],
  ['coding mode', { mode: 'coding' }, {}, null],
  ['an edited built-in mode', { mode: 'pm', modeOverrides: { pm: { instructions: 'Always answer as a haiku.' } } }, {}, null],
  ['a custom mode', { mode: 'mine', customModes: [{ id: 'mine', label: 'Mine', instructions: 'Be brief.' }] }, {}, null],
  ['SearXNG only', { searxngUrl: 'http://searx.local' }, {}, null],
  ['a Serper key', {}, { serper: 'k' }, null],
  ['Serper beats SearXNG', { searxngUrl: 'http://searx.local' }, { serper: 'k' }, null],
  ['a Firecrawl key', {}, { firecrawl: 'k' }, null],
  ['Serper and Firecrawl', {}, { serper: 'k', firecrawl: 'k' }, null],
  ['an Anthropic key alone changes nothing', {}, { anthropic: 'k' }, null],
  ['a project with rules', {}, {}, project({ rules: '  Answer in British English.  \n' })],
  ['a project with blank rules', {}, {}, project({ rules: '   ' })],
  ['a project with files', {}, {}, project({ files: [
    { name: 'a.txt', size: 5, type: 'text/plain', kind: 'file', content: 'hello' },
    { name: 'big.bin', size: 5_000_000, type: 'application/octet-stream', kind: 'file', tooBig: true },
    { name: 'odd.xyz', size: 10, type: 'application/x-odd', kind: 'file', unsupported: true },
    { name: 'p.pdf', size: 2048, type: 'application/pdf', kind: 'pdf', parseError: 'bad xref' },
    { name: 'e<mpty>.txt', size: 0, type: '', kind: 'file' },
  ] as never })],
  ['a project file longer than the per-file limit', {}, {}, project({ files: [{ name: 'long.txt', size: 40_000, type: 'text/plain', kind: 'file', content: 'x'.repeat(40_000) }] as never })],
  ['files past the total limit', {}, {}, project({ files: [1, 2, 3].map(i => ({ name: `f${i}.txt`, size: 30_000, type: 'text/plain', kind: 'file', content: String(i).repeat(30_000) })) as never })],
  ['extra context is appended last', {}, {}, null, '<project_file>notes</project_file>'],
  ['everything at once', { name: 'Yash', context: 'x', tone: 'formal', mode: 'cto', searxngUrl: 'http://s' }, { firecrawl: 'k' }, project({ rules: 'r', files: [{ name: 'a.txt', size: 1, type: 'text/plain', kind: 'file', content: 'c' }] as never }), 'extra'],
];

describe('buildSystemPrompt matches the legacy function, word for word', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T12:00:00')); });
  afterEach(() => vi.useRealTimers());

  it.each(CASES)('%s', (_name, prefs, apiKeys, proj, extra) => {
    const mine = buildSystemPrompt({ prefs, project: proj ?? undefined, apiKeys, extraContext: extra });
    expect(mine).toBe(legacyPrompt(prefs, apiKeys, proj, extra));
  });

  it('the date line is today\'s, written out', () => {
    expect(buildSystemPrompt({ prefs: {}, apiKeys: {} })).toContain("Today's date is October 4, 2026.");
  });
});

describe('buildAttachmentContext matches legacy', () => {
  const run = (files: unknown[], opts?: { nativePdfNames?: Set<string>; nativeImageNames?: Set<string> }): string => {
    const src = ['const ATTACHMENT_CONTEXT_CHAR_LIMIT = 70_000; const ATTACHMENT_FILE_CHAR_LIMIT = 30_000;', fnSource('fmtSize'), fnSource('safeFileAttr'), fnSource('buildAttachmentContext'), 'return buildAttachmentContext;'].join('\n');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return (new Function(src)() as (f: unknown[], o?: unknown) => string)(files, opts);
  };
  const files = [
    { name: 'a.md', size: 1500, type: 'text/markdown', kind: 'file', content: '# hi' },
    { name: 'pic.png', size: 100, type: 'image/png', kind: 'image' },
    { name: 'doc.pdf', size: 3_000_000, type: 'application/pdf', kind: 'pdf', content: 'pdf text' },
    { name: 'branch', size: 0, kind: 'branch', quote: 'a "quoted" <passage>', content: 'User: hi\n\nAssistant: yo' },
  ];

  it('is identical, including native blocks and the empty case', () => {
    expect(buildAttachmentContext(files as never)).toBe(run(files));
    const opts = { nativePdfNames: new Set(['doc.pdf']), nativeImageNames: new Set(['pic.png']) };
    expect(buildAttachmentContext(files as never, opts)).toBe(run(files, opts));
    expect(buildAttachmentContext([])).toBe('');
    expect(buildAttachmentContext([null, undefined])).toBe('');
  });
});
