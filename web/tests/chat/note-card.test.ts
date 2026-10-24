import { openChatDb } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests } from '../../src/db/chat-repo';
import { NOTES_KEY, openNotesDb } from '../../src/db/notes';
import { useAppStore } from '../../src/state/app-store';
import { useChatStore } from '../../src/chat/chat-store';
import { sendMessage, setRunTurnDepsForTests } from '../../src/chat/send';
import { parseStream, noteCardHTML } from '../../src/chat/stream-html';
import { readNotes } from '../../src/notes/notes-repo';
import { availableTools } from '../../src/providers/tool-specs';
import type { RunTurnDeps } from '../../src/chat/run-turn';
import type { ChatProvider, ChatRequest, ProviderEvent } from '../../src/providers/types';

// The path a user cares about: the model calls create_note mid-reply, the document lands in Notes,
// and the saved reply carries a card that survives a reload (it is plain markup in `stream`).

async function reset(): Promise<void> {
  await resetChatRepoForTests();
  const d = openChatDb();
  await d.kv.clear();
  d.close();
  const n = openNotesDb();
  await n.kv.put({ key: NOTES_KEY, value: [] });
  n.close();
  localStorage.clear();
  localStorage.setItem('nl_clarify_first', '0');
  useChatStore.setState({ live: {}, failed: {} });
  await useAppStore.getState().hydrate();
}

const seen: ChatRequest[] = [];
const filing = (call: Record<string, unknown>): RunTurnDeps => {
  const claude: ChatProvider = {
    id: 'claude', caps: { thinking: false, nativeToolUse: true, maxToolRounds: 3 },
    stream: async function* (req): AsyncGenerator<ProviderEvent> {
      seen.push(req);
      const result = await req.toolRunner?.('create_note', call, new AbortController().signal);
      yield { t: 'delta', text: 'Saved the plan.' };
      yield { t: 'done', text: `Saved the plan. (${result ? 'tool ran' : 'no tool'})` };
    },
  };
  return { providers: { claude, deepseek: claude }, canFallBackToDeepSeek: false };
};

beforeEach(async () => { seen.length = 0; await reset(); });
afterEach(() => setRunTurnDepsForTests(null));

describe('a note filed from a reply', () => {
  it('is offered on a main thread, saved to Notes, and left as a card in the saved reply', async () => {
    localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: 'x', path: '/p', bytes: 1 }));
    setRunTurnDepsForTests(() => filing({ title: 'Launch plan', content: '## Goals\n\n- ship' }));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'write a launch plan');

    expect(seen[0]!.tools.map(t => t.name)).toContain('create_note');
    const [note] = await readNotes();
    expect(note).toMatchObject({ title: 'Launch plan' });

    const ai = parseStream((await loadChatState()).threads[id]!.stream as string).find(t => t.role === 'ai')!;
    expect(ai.html).toContain(`data-note-id="${note!.id}"`);
    expect(ai.html).toContain('Launch plan');
    expect(ai.html).toContain('Saved the plan.');
  });

  it('leaves no card when Notes are locked, and the model is told so', async () => {
    setRunTurnDepsForTests(() => filing({ title: 'Launch plan', content: 'x' }));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'write a launch plan');
    expect(await readNotes()).toEqual([]);
    expect((await loadChatState()).threads[id]!.stream).not.toContain('note-ref');
  });
});

describe('the create_note tool', () => {
  it('is only offered when the chat can file notes', () => {
    expect(availableTools({ apiKeys: {}, notes: true }).map(t => t.name)).toContain('create_note');
    expect(availableTools({ apiKeys: {} }).map(t => t.name)).not.toContain('create_note');
  });

  it('draws a card that escapes the title', () => {
    const html = noteCardHTML({ id: 'n_1', title: '<b>"x"</b>' });
    expect(html).toContain('data-note-id="n_1"');
    expect(html).not.toContain('<b>');
  });
});
