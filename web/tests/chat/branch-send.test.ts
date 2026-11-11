import { openChatDb } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests } from '../../src/db/chat-repo';
import { useAppStore } from '../../src/state/app-store';
import { useUiStore } from '../../src/state/ui-store';
import { useChatStore } from '../../src/chat/chat-store';
import { useBranchStore } from '../../src/branch/branch-store';
import { sendMessage, setRunTurnDepsForTests } from '../../src/chat/send';
import { retryBranchTurn, sendBranchMessage, branchKey } from '../../src/branch/branch-send';
import {
  closeBranch, deleteBranch, dropAllBranches, openBranch, promoteBranch, restoreMain, toggleCollapse, toggleReader,
} from '../../src/branch/actions';
import type { RunTurnDeps } from '../../src/chat/run-turn';
import type { ChatProvider, ChatRequest, ProviderEvent } from '../../src/providers/types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const seen: ChatRequest[] = [];
function provider(id: 'claude' | 'deepseek', script: (req: ChatRequest) => AsyncGenerator<ProviderEvent>): ChatProvider {
  return { id, caps: { thinking: false, nativeToolUse: false, maxToolRounds: 0 }, stream: req => { seen.push(req); return script(req); } };
}
const reply = (text: string, usage = { inputTokens: 10, outputTokens: 5 }) =>
  async function* (): AsyncGenerator<ProviderEvent> { yield { t: 'delta', text }; yield { t: 'done', text, usage }; };
const deps = (claude: ChatProvider, deepseek?: ChatProvider): RunTurnDeps => ({
  providers: { claude, deepseek: deepseek ?? provider('deepseek', reply('ds')) },
  canFallBackToDeepSeek: false,
});

async function reset(): Promise<void> {
  await resetChatRepoForTests();
  const d = openChatDb();
  await d.kv.clear();
  d.close();
  localStorage.clear();
  useChatStore.setState({ live: {}, failed: {} });
  useBranchStore.getState().clear();
  await useAppStore.getState().hydrate();
}
const saved = async (id: string) => (await loadChatState()).threads[id]!;

/** A thread with one finished exchange, so a branch has a main conversation above it. */
async function threadWithHistory(): Promise<string> {
  setRunTurnDepsForTests(() => deps(provider('claude', reply('Main answer.'))));
  const id = (await useAppStore.getState().createThread())!;
  await sendMessage(id, 'Main question');
  seen.length = 0;
  return id;
}

beforeEach(async () => { seen.length = 0; await reset(); });
afterEach(() => { setRunTurnDepsForTests(null); useBranchStore.getState().clear(); });

describe('opening', () => {
  it('opening a branch makes one panel, active, with a recents row and the legacy depth/model rules', async () => {
    const tid = await threadWithHistory();
    const id = openBranch({ threadId: tid, quote: 'a passage', fresh: true, bid: 'b1', anchorBid: 'b1' });
    expect(id).toBe('b1');
    const b = useBranchStore.getState().open.b1!;
    expect(b).toMatchObject({ depth: 1, parentBid: null, anchorBid: 'b1', collapsed: false, reader: false, modelPref: 'sonnet', threadId: tid });
    expect(useBranchStore.getState().activeId).toBe('b1');
    await sleep(20);
    expect((await saved(tid)).branchRecents!.b1).toMatchObject({ id: 'b1', quote: 'a passage', depth: 1 });
    expect((await saved(tid)).branchSnapshots).toEqual({}); // empty: remembered, not snapshotted
  });

  it('reopening an open branch re-focuses it: never a second panel (#002/#003)', async () => {
    const tid = await threadWithHistory();
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    expect(Object.keys(useBranchStore.getState().open)).toEqual(['b1']);
  });

  it('opening an unrelated branch closes the others; opening a child keeps its ancestors', async () => {
    const tid = await threadWithHistory();
    openBranch({ threadId: tid, quote: 'root', bid: 'r' });
    openBranch({ threadId: tid, quote: 'child', bid: 'c', parentBranchId: 'r' });
    expect(Object.keys(useBranchStore.getState().open).sort()).toEqual(['c', 'r']);
    expect(useBranchStore.getState().open.c).toMatchObject({ depth: 2, parentBid: 'r' });
    openBranch({ threadId: tid, quote: 'grandchild', bid: 'g', parentBranchId: 'c' });
    expect(useBranchStore.getState().open.g!.depth).toBe(3);
    expect(Object.keys(useBranchStore.getState().open).sort()).toEqual(['c', 'g', 'r']);
    openBranch({ threadId: tid, quote: 'elsewhere', bid: 'x' });
    expect(Object.keys(useBranchStore.getState().open)).toEqual(['x']);
  });

  it('a child inherits its parent\'s model; a root follows the default', async () => {
    const tid = await threadWithHistory();
    openBranch({ threadId: tid, quote: 'root', bid: 'r' });
    useBranchStore.getState().patch('r', { modelPref: 'deepseek' });
    openBranch({ threadId: tid, quote: 'child', bid: 'c', parentBranchId: 'r' });
    expect(useBranchStore.getState().open.c!.modelPref).toBe('deepseek');
  });
});

describe('collapse and reader', () => {
  it('expanding one collapses the rest; collapsing leaves reader mode', async () => {
    const tid = await threadWithHistory();
    openBranch({ threadId: tid, quote: 'root', bid: 'r' });
    openBranch({ threadId: tid, quote: 'child', bid: 'c', parentBranchId: 'r' });
    toggleCollapse('r'); // collapse r
    expect(useBranchStore.getState().open.r!.collapsed).toBe(true);
    toggleCollapse('r'); // expand r: collapses c
    expect(useBranchStore.getState().open.r!.collapsed).toBe(false);
    expect(useBranchStore.getState().open.c!.collapsed).toBe(true);
    toggleReader('r', { width: 400, height: 300 });
    expect(useBranchStore.getState().open.r).toMatchObject({ reader: true, width: 620, height: 480, userSized: true });
    toggleCollapse('r');
    expect(useBranchStore.getState().open.r).toMatchObject({ collapsed: true, reader: false });
  });

  it('only one panel is in reader mode at a time', async () => {
    const tid = await threadWithHistory();
    openBranch({ threadId: tid, quote: 'root', bid: 'r' });
    openBranch({ threadId: tid, quote: 'child', bid: 'c', parentBranchId: 'r' });
    toggleReader('r');
    toggleReader('c');
    expect(useBranchStore.getState().open.r!.reader).toBe(false);
    expect(useBranchStore.getState().open.c!.reader).toBe(true);
  });
});

describe('branch chat', () => {
  it('the first message sends main history + the quote merged into the question; only the branch\'s own messages are saved', async () => {
    const tid = await threadWithHistory();
    setRunTurnDepsForTests(() => deps(provider('claude', reply('Branch answer.'))));
    openBranch({ threadId: tid, quote: 'the quoted words', fresh: true, bid: 'b1', anchorBid: 'b1' });
    await sendBranchMessage(tid, 'b1', 'tell me more');

    expect(seen[0]!.messages).toEqual([
      { role: 'user', content: 'Main question' },
      { role: 'assistant', content: 'Main answer.' },
      { role: 'user', content: 'I\'ve highlighted this passage to explore: "the quoted words"\n\ntell me more' },
    ]);
    const snap = (await saved(tid)).branchSnapshots!.b1!;
    expect(snap.messages).toEqual([{ role: 'user', content: 'tell me more' }, { role: 'assistant', content: 'Branch answer.' }]);
    expect(snap.bodyHTML).toContain('tell me more');
    expect(snap.bodyHTML).toContain('Branch answer.');
    expect(snap).toMatchObject({ tokenIn: 10, tokenOut: 5, provider: 'anthropic', model: 'claude-sonnet-5', quote: 'the quoted words', modelPref: 'sonnet' });
    // the main conversation is untouched
    expect((await saved(tid)).mainMessages).toHaveLength(2);
  });

  it('a follow-up sends: main, "Exploring: quote", the branch\'s messages, then the new question', async () => {
    const tid = await threadWithHistory();
    setRunTurnDepsForTests(() => deps(provider('claude', reply('ok'))));
    openBranch({ threadId: tid, quote: 'q1', bid: 'b1' });
    await sendBranchMessage(tid, 'b1', 'first');
    seen.length = 0;
    await sendBranchMessage(tid, 'b1', 'second');
    expect(seen[0]!.messages).toEqual([
      { role: 'user', content: 'Main question' }, { role: 'assistant', content: 'Main answer.' },
      { role: 'user', content: 'Exploring: "q1"' },
      { role: 'user', content: 'first' }, { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ]);
    expect((await saved(tid)).branchSnapshots!.b1!.tokenIn).toBe(20); // usage accumulates
  });

  it('a nested branch is sent its parent\'s quote and conversation, even after the parent panel is closed', async () => {
    const tid = await threadWithHistory();
    setRunTurnDepsForTests(() => deps(provider('claude', reply('ok'))));
    openBranch({ threadId: tid, quote: 'parent quote', bid: 'p' });
    await sendBranchMessage(tid, 'p', 'parent q');
    openBranch({ threadId: tid, quote: 'child quote', bid: 'c', parentBranchId: 'p' });
    await closeBranch('p');
    expect(useBranchStore.getState().open.p).toBeUndefined();
    seen.length = 0;
    await sendBranchMessage(tid, 'c', 'child q');
    expect(seen[0]!.messages.map(m => m.content)).toEqual([
      'Main question', 'Main answer.',
      'Exploring this passage: "parent quote"', 'parent q', 'ok',
      'I\'ve highlighted this passage to explore: "child quote"\n\nchild q',
    ]);
  });

  it('a branch uses its OWN model, not the main one', async () => {
    const tid = await threadWithHistory();
    const claude = provider('claude', reply('from claude'));
    const ds = provider('deepseek', reply('from deepseek'));
    setRunTurnDepsForTests(() => deps(claude, ds));
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    useBranchStore.getState().patch('b1', { modelPref: 'deepseek' });
    seen.length = 0;
    await sendBranchMessage(tid, 'b1', 'hi');
    expect(seen[0]!.model).toBe('deepseek-v4-flash');
    expect((await saved(tid)).branchSnapshots!.b1).toMatchObject({ provider: 'deepseek', modelPref: 'deepseek' });
  });

  it('a failed branch reply keeps the question, shows a calm error, and retry does not duplicate it', async () => {
    const tid = await threadWithHistory();
    let attempt = 0;
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      attempt += 1;
      if (attempt === 1) yield { t: 'error', kind: 'other', message: 'Claude is overloaded right now — try again in a moment.' };
      else yield { t: 'done', text: 'recovered' };
    })));
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    await sendBranchMessage(tid, 'b1', 'ask');
    expect(useChatStore.getState().failed[branchKey('b1')]).toMatchObject({ config: false });
    expect((await saved(tid)).branchSnapshots!.b1!.bodyHTML).toContain('err-block');
    expect((await saved(tid)).branchSnapshots!.b1!.messages).toEqual([]);

    await retryBranchTurn(tid, 'b1');
    const snap = (await saved(tid)).branchSnapshots!.b1!;
    expect(snap.messages).toEqual([{ role: 'user', content: 'ask' }, { role: 'assistant', content: 'recovered' }]);
    expect(snap.bodyHTML.match(/class="msg user"/g)).toHaveLength(1);
    expect(snap.bodyHTML).not.toContain('err-block');
  });

  it('closing the panel mid-reply still saves the reply (bugs #008/#009)', async () => {
    const tid = await threadWithHistory();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () { await gate; yield { t: 'done', text: 'late answer' }; })));
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    const sending = sendBranchMessage(tid, 'b1', 'ask');
    await sleep(30);
    await closeBranch('b1');
    expect(useBranchStore.getState().open.b1).toBeUndefined();
    release();
    await sending;
    const snap = (await saved(tid)).branchSnapshots!.b1!;
    expect(snap.messages).toEqual([{ role: 'user', content: 'ask' }, { role: 'assistant', content: 'late answer' }]);
  });

  it('switching away drops every panel but keeps their content', async () => {
    const tid = await threadWithHistory();
    setRunTurnDepsForTests(() => deps(provider('claude', reply('kept'))));
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    await sendBranchMessage(tid, 'b1', 'ask');
    await dropAllBranches();
    expect(useBranchStore.getState().order).toEqual([]);
    expect((await saved(tid)).branchSnapshots!.b1!.messages).toHaveLength(2);
  });

  it('closing an empty branch leaves a (forced) snapshot, as legacy does', async () => {
    const tid = await threadWithHistory();
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    await closeBranch('b1');
    expect((await saved(tid)).branchSnapshots!.b1).toMatchObject({ id: 'b1', messages: [], quote: 'q' });
  });
});

describe('delete', () => {
  it('asks first, then removes the branch and its whole subtree; cancelling changes nothing', async () => {
    const tid = await threadWithHistory();
    setRunTurnDepsForTests(() => deps(provider('claude', reply('ok'))));
    openBranch({ threadId: tid, quote: 'root', bid: 'r' });
    await sendBranchMessage(tid, 'r', 'a');
    openBranch({ threadId: tid, quote: 'child', bid: 'c', parentBranchId: 'r' });
    await sendBranchMessage(tid, 'c', 'b');

    const pending = deleteBranch('r', tid);
    await sleep(10);
    expect(useUiStore.getState().confirm).toMatchObject({ heading: 'Delete branches?', actionLabel: 'Delete branches' });
    useUiStore.getState().resolveConfirm(false);
    expect(await pending).toBe(false);
    expect(Object.keys((await saved(tid)).branchSnapshots!).sort()).toEqual(['c', 'r']);

    const again = deleteBranch('r', tid);
    await sleep(10);
    useUiStore.getState().resolveConfirm(true);
    expect(await again).toBe(true);
    const after = await saved(tid);
    expect(after.branchSnapshots).toEqual({});
    expect(after.branchRecents).toEqual({});
    expect(useBranchStore.getState().order).toEqual([]);
  });

  it('a reply that finishes after its branch was deleted does not bring the branch back', async () => {
    const tid = await threadWithHistory();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    setRunTurnDepsForTests(() => deps(provider('claude', async function* (req) {
      await Promise.race([gate, new Promise<void>(r => req.signal.addEventListener('abort', () => r()))]);
      yield { t: 'done', text: 'zombie' };
    })));
    openBranch({ threadId: tid, quote: 'q', bid: 'b1' });
    const sending = sendBranchMessage(tid, 'b1', 'ask');
    await sleep(30);
    const del = deleteBranch('b1', tid);
    await sleep(10);
    useUiStore.getState().resolveConfirm(true);
    await del;
    release();
    await sending;
    const after = await saved(tid);
    expect(after.branchSnapshots!.b1).toBeUndefined();
    expect(after.branchRecents!.b1).toBeUndefined();
  });
});

describe('promote to main', () => {
  it('replaces the main conversation with the branch, remembers the old one, and restores it from the breadcrumb', async () => {
    const tid = await threadWithHistory();
    setRunTurnDepsForTests(() => deps(provider('claude', reply('Branch answer.'))));
    openBranch({ threadId: tid, quote: 'a long quoted passage that will be cut off somewhere', bid: 'b1' });
    await sendBranchMessage(tid, 'b1', 'dig in');
    const before = await saved(tid);

    await promoteBranch('b1', 'Fallback');
    const t = await saved(tid);
    expect(t.stream).toContain('Branch answer.');
    expect(t.stream).not.toContain('Main answer.');
    expect(t.mainMessages).toEqual([{ role: 'user', content: 'dig in' }, { role: 'assistant', content: 'Branch answer.' }]);
    expect(t.h1).toContain('Now exploring: <span class="accent">a long quoted passage that will be…</span>');
    expect(String(t.eyebrow)).toMatch(/^Promoted from branch · /);
    expect(t.promotedCrumbTitle).toBe('a long quoted passage that will be…');
    expect(t.title).toBe(before.title); // the thread keeps its own name in the sidebar
    const history = t.mainHistory as Array<{ title: string; chatHTML: string; messages: unknown[] }>;
    expect(history).toHaveLength(1);
    expect(history[0]!.chatHTML).toBe(before.stream);
    expect(history[0]!.messages).toHaveLength(2);

    await restoreMain(tid, 0);
    const back = await saved(tid);
    expect(back.stream).toBe(before.stream);
    expect(back.mainMessages).toEqual(before.mainMessages);
    expect(back.mainHistory).toEqual([]);
    expect(back.promotedCrumbTitle).toBeUndefined();
  });
});
