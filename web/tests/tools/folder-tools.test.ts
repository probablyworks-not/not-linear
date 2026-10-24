import { afterEach, describe, expect, it, vi } from 'vitest';
import { runListProjectFiles, runReadProjectFile } from '../../src/tools/folder-tools';
import { executeTool, toolStatusLabel, toolResultTitle } from '../../src/tools/tool-runners';
import { availableTools, FOLDER_TOOL_HINT, toolPromptSection } from '../../src/providers/tool-specs';
import { maxToolRoundsFor } from '../../src/providers/deepseek';
import { DEEPSEEK_MAX_FOLDER_TOOL_ROUNDS, DEEPSEEK_MAX_TOOL_ROUNDS } from '../../src/lib/api-client';

const signal = new AbortController().signal;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(reply: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => json(reply, status));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const sentBody = (fn: ReturnType<typeof vi.fn>): Record<string, unknown> => JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

describe('folder tool availability', () => {
  it('is offered only when the project has a linked folder', () => {
    const names = (folder: boolean): string[] => availableTools({ apiKeys: {}, folder }).map(t => t.name);
    expect(names(false)).not.toContain('list_project_files');
    expect(names(false)).not.toContain('read_project_file');
    expect(names(true)).toEqual(expect.arrayContaining(['list_project_files', 'read_project_file']));
  });

  it('puts a single short hint in the prompt, only with a folder', () => {
    expect(toolPromptSection(availableTools({ apiKeys: {}, folder: true }), { apiKeys: {}, folder: true })).toBe(FOLDER_TOOL_HINT);
    expect(toolPromptSection(availableTools({ apiKeys: {} }), { apiKeys: {} })).toBe('');
    expect(FOLDER_TOOL_HINT.length).toBeLessThan(260);
  });

  it('never lets the model name the folder root', () => {
    for (const t of availableTools({ apiKeys: {}, folder: true }).filter(s => s.name.endsWith('project_files') || s.name === 'read_project_file')) {
      expect(Object.keys((t.jsonSchema as { properties: Record<string, unknown> }).properties)).not.toContain('root');
    }
  });
});

describe('DeepSeek round budget', () => {
  it('keeps 2 rounds for web research and gives folder browsing more', () => {
    expect(maxToolRoundsFor([{ name: 'wikipedia_search' }, { name: 'fetch_url' }])).toBe(DEEPSEEK_MAX_TOOL_ROUNDS);
    expect(maxToolRoundsFor([{ name: 'wikipedia_search' }, { name: 'read_project_file' }])).toBe(DEEPSEEK_MAX_FOLDER_TOOL_ROUNDS);
    expect(DEEPSEEK_MAX_FOLDER_TOOL_ROUNDS).toBeGreaterThan(DEEPSEEK_MAX_TOOL_ROUNDS);
  });
});

describe('runListProjectFiles', () => {
  it('formats one level and sends the app-supplied root', async () => {
    const f = mockFetch({ ok: true, path: 'src', entries: [{ name: 'chat', type: 'dir' }, { name: 'main.ts', type: 'file', size: 2048 }] });
    const out = await runListProjectFiles('/proj', 'src', signal);
    expect(out).toBe('Directory src:\ndir:  chat/\nfile: main.ts (2.0 KB)');
    expect(sentBody(f)).toEqual({ path: '/proj', sub: 'src' });
  });

  it('turns a refusal into text for the model instead of throwing', async () => {
    mockFetch({ ok: false, error: 'path is outside the linked folder' });
    expect(await runListProjectFiles('/proj', '../', signal)).toContain('outside the linked folder');
  });

  it('survives a non-JSON failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    expect(await runListProjectFiles('/proj', '', signal)).toMatch(/^Cannot list "\.": /);
  });
});

describe('runReadProjectFile', () => {
  it('returns a whole small file as is', async () => {
    mockFetch({ ok: true, text: 'hello', start: 0, end: 5, total: 5 });
    expect(await runReadProjectFile('/proj', 'a.txt', {}, signal)).toBe('hello');
  });

  it('tells the model how to keep reading a long file', async () => {
    const f = mockFetch({ ok: true, text: 'abc', start: 0, end: 4000, total: 9000 });
    const out = await runReadProjectFile('/proj', 'big.txt', { offset: 0, query: 'x' }, signal);
    expect(out).toContain('[showing chars 0-4000 of 9000.');
    expect(out).toContain('offset:4000');
    expect(sentBody(f)).toMatchObject({ path: '/proj', file: 'big.txt', query: 'x' });
  });

  it('reports a blocked secrets file', async () => {
    mockFetch({ ok: false, error: 'blocked: looks like a secrets file' });
    expect(await runReadProjectFile('/proj', '.env', {}, signal)).toBe('Cannot read ".env": blocked: looks like a secrets file');
  });

  it('refuses an empty path without calling the server', async () => {
    const f = mockFetch({ ok: true });
    expect(await runReadProjectFile('/proj', '  ', {}, signal)).toContain('path is required');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('executeTool dispatch', () => {
  it('reads inside the context folder and ignores any root the model sends', async () => {
    const f = mockFetch({ ok: true, text: 'x', start: 0, end: 1, total: 1 });
    await executeTool('read_project_file', { path: 'a.ts', root: '/etc' } as never, signal, { folderRoot: '/proj' });
    expect(sentBody(f).path).toBe('/proj');
  });

  it('says so when no folder is linked, without any request', async () => {
    const f = mockFetch({ ok: true });
    expect(await executeTool('list_project_files', {}, signal)).toBe('No project folder is linked to this chat.');
    expect(f).not.toHaveBeenCalled();
  });

  it('has status and result labels', () => {
    expect(toolStatusLabel('list_project_files', { path: 'src' })).toBe('Reading folder src…');
    expect(toolStatusLabel('read_project_file', { path: 'a.ts' })).toBe('Reading a.ts…');
    expect(toolResultTitle('read_project_file', { path: 'a.ts' })).toBe('Project file: a.ts');
  });
});
