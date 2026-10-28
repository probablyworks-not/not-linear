import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCanvasTurn, setCanvasDepsForTests } from '../../src/canvas/exec/run-canvas-turn';
import { createCanvas, getCanvas, resetCanvasDbForTests, updateCanvas } from '../../src/canvas/canvas-repo';
import { createRootThread } from '../../src/canvas/domain/commands';
import { clearProjectContextCaches } from '../../src/chat/project-context';
import { setToolEnvForTests } from '../../src/tools/env';
import type { ChatProvider, ChatRequest } from '../../src/providers/types';
import type { CanvasDoc } from '../../src/canvas/types';
import type { PersistedProject } from '../../src/db/types';

const project = (path = '/fixture/repo'): PersistedProject => ({
  id: 'p1', name: 'Repo', path, rules: 'Explain architecture with evidence',
  files: [{ name: 'guide.txt', content: 'The uploaded guide', kind: 'text', size: 18, type: 'text/plain' }],
});
const requests: ChatRequest[] = [];
const posts: { url: string; body: Record<string, unknown> }[] = [];
const provider = (inspect: (req: ChatRequest) => Promise<void> = async () => {}): ChatProvider => ({
  id: 'claude', caps: { thinking: true, nativeToolUse: true, maxToolRounds: 5 },
  async *stream(req) {
    requests.push(req);
    await inspect(req);
    yield { t: 'done', text: 'Architecture explained from repository evidence.' };
  },
});
async function seed() {
  const c = await createCanvas({ projectId: 'p1', title: 'Repo' });
  const { result: threadId } = await updateCanvas(c.summary.id, d => createRootThread(d, 'Explain the agents repo', { now: 1 }).thread.id);
  const hooks = {
    apply: <T,>(fn: (d: CanvasDoc) => T) => updateCanvas(c.summary.id, fn).then(r => r.result),
    onDelta: () => {}, onStatus: vi.fn(), register: (_c: AbortController) => {},
  };
  return { canvasId: c.summary.id, threadId, hooks };
}
function use(p: ChatProvider, fallback = false) {
  setCanvasDepsForTests(() => ({ providers: { claude: p, deepseek: p, openai: p, gemini: p }, canFallBackToDeepSeek: fallback }));
}
beforeEach(() => {
  resetCanvasDbForTests(`project-context-${Math.random()}`);
  clearProjectContextCaches(); requests.length = 0; posts.length = 0;
  setToolEnvForTests(() => ({ apiKeys: {} }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    posts.push({ url: String(url), body });
    const data = String(url).includes('scan_project')
      ? { ok: true, contextFiles: [{ present: true, filename: 'agents.ts', relativePath: 'src/agents.ts', text: `Agent Orion orchestrates workers in ${body.path}` }] }
      : String(url).includes('list_dir')
        ? { ok: true, entries: [{ name: 'agents.ts', type: 'file' }] }
        : { ok: true, text: 'Orion calls worker Vega', start: 0, end: 23, total: 23 };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { setCanvasDepsForTests(null); setToolEnvForTests(null); vi.unstubAllGlobals(); });

describe('Canvas project repository access', () => {
  it('sends inherited rules/uploads and retrieved code, and executes folder tools against the app-selected root', async () => {
    const { threadId, hooks } = await seed();
    use(provider(async req => {
      expect(req.systemPrompt).toContain('Explain architecture with evidence');
      expect(req.systemPrompt).toContain('The uploaded guide');
      expect(req.systemPrompt).toContain('Agent Orion');
      expect(req.systemPrompt).toContain('list_project_files');
      expect(req.tools.map(t => t.name)).toEqual(expect.arrayContaining(['list_project_files', 'read_project_file']));
      expect(req.tools.map(t => t.name)).not.toContain('create_note');
      expect(await req.toolRunner!('list_project_files', { path: '' }, req.signal!)).toContain('agents.ts');
      expect(await req.toolRunner!('read_project_file', { path: 'src/agents.ts', folderRoot: '/wrong' }, req.signal!)).toContain('Vega');
    }));
    const res = await runCanvasTurn({ threadId, submissionId: 's1', modelPref: 'opus', prefs: {}, project: project() }, hooks);
    expect(res.status).toBe('completed');
    expect(posts.find(p => p.url.includes('read_file'))?.body).toMatchObject({ path: '/fixture/repo', file: 'src/agents.ts' });
    expect(hooks.onStatus).toHaveBeenLastCalledWith(null);
  });

  it('does not offer folder tools or scan for an unassigned Canvas', async () => {
    const { threadId, hooks } = await seed(); use(provider());
    await runCanvasTurn({ threadId, submissionId: 's1', modelPref: 'opus', prefs: {} }, hooks);
    expect(requests[0]!.tools.map(t => t.name)).not.toContain('read_project_file');
    expect(posts.some(p => p.url.includes('scan_project'))).toBe(false);
  });

  it('does not reuse stale excerpts after the same project links a different root', async () => {
    const { threadId, hooks } = await seed(); use(provider());
    for (const [i, path] of ['/repo/A', '/repo/B'].entries()) {
      await runCanvasTurn({ threadId, submissionId: `s${i}`, modelPref: 'opus', prefs: {}, project: project(path) }, hooks);
    }
    expect(requests[1]!.systemPrompt).toContain('/repo/B');
    expect(requests[1]!.systemPrompt).not.toContain('/repo/A');
  });

  it('keeps project tools and evidence through the Claude-to-DeepSeek fallback', async () => {
    const { threadId, hooks } = await seed();
    const p: ChatProvider = { id: 'claude', caps: { thinking: true, nativeToolUse: true, maxToolRounds: 5 }, async *stream(req) {
      requests.push(req);
      if (requests.length === 1) yield { t: 'error', kind: 'rate_limit', message: 'rate limit' };
      else yield { t: 'done', text: 'Recovered' };
    } };
    use(p, true);
    const result = await runCanvasTurn({ threadId, submissionId: 's1', modelPref: 'opus', prefs: {}, project: project() }, hooks);
    expect(result.status).toBe('completed'); expect(requests).toHaveLength(2);
    expect(requests[1]!.systemPrompt).toContain('Agent Orion');
    expect(requests[1]!.tools.map(t => t.name)).toContain('read_project_file');
    expect(requests[1]!.toolRunner).toBe(requests[0]!.toolRunner);
  });

  it('cancels a pending scan without starting a provider or leaving a streaming run', async () => {
    const { canvasId, threadId, hooks } = await seed(); use(provider());
    let controller: AbortController | undefined;
    let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      start();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }));
    const pending = runCanvasTurn({ threadId, submissionId: 's1', modelPref: 'opus', prefs: {}, project: project() }, { ...hooks, register: c => { controller = c; } });
    await started; controller!.abort();
    expect((await pending).status).toBe('cancelled'); expect(requests).toHaveLength(0);
    expect((await getCanvas(canvasId))!.runs[0]!.status).toBe('cancelled');
  });
  it('still offers live folder tools when the initial scan is unavailable', async () => {
    const { threadId, hooks } = await seed(); use(provider());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'scan unavailable' }), { status: 403 })));
    const res = await runCanvasTurn({ threadId, submissionId: 's1', modelPref: 'opus', prefs: {}, project: project() }, hooks);
    expect(res.status).toBe('completed');
    expect(requests[0]!.tools.map(t => t.name)).toContain('list_project_files');
    expect(requests[0]!.systemPrompt).toContain('A project folder is linked');
  });

  it('keeps the submission root when project state changes while a scan is pending', async () => {
    const { threadId, hooks } = await seed();
    const current = project('/repo/original');
    use(provider(async req => {
      await req.toolRunner!('read_project_file', { path: 'README.md' }, req.signal!);
    }));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('scan_project')) current.path = '/repo/other';
      return originalFetch(url, init);
    }));
    await runCanvasTurn({ threadId, submissionId: 's1', modelPref: 'opus', prefs: {}, project: current }, hooks);
    expect(posts.find(p => p.url.includes('read_file'))?.body.path).toBe('/repo/original');
  });

});
