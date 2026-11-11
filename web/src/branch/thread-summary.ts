import { create } from 'zustand';
import { readApiKeys } from '../lib/api-keys';
import { loggedFetch, readLoggedErrorPayload, MODEL_CONNECT_TIMEOUT_MS } from '../lib/api-client';
import { sseData } from '../providers/sse';
import type { PersistedThread } from '../db/types';

// The thread map's "Summarize" (app.js:2742): one small DeepSeek call per chat, cached for
// the session. It always uses DeepSeek whatever model the chat uses, as in legacy. Unlike
// legacy's bare fetch it goes through loggedFetch, so the call shows in the request log with
// its key redacted like every other.

export interface ParsedSummary { about: string; ideas: string[] }

/** app.js:2670 renderSummaryHTML's parsing: "ABOUT: …\n\nIDEAS:\n- …" into its two parts. */
export function parseSummary(text: string): ParsedSummary {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let about = '';
  const ideas: string[] = [];
  let inIdeas = false;
  for (const line of lines) {
    if (/^ABOUT:\s*/i.test(line)) { about = line.replace(/^ABOUT:\s*/i, ''); inIdeas = false; }
    else if (/^IDEAS:\s*/i.test(line)) { inIdeas = true; }
    else if (inIdeas && /^[-•*]\s+/.test(line)) { ideas.push(line.replace(/^[-•*]\s+/, '')); }
    else if (inIdeas && line) { ideas.push(line); }
    else if (!inIdeas && !about) { about = line; }
  }
  // Nothing recognisable: show the text as it came.
  return about || ideas.length ? { about, ideas } : { about: text, ideas: [] };
}

export const SUMMARY_SYSTEM_PROMPT = 'You summarize research threads. Always respond in exactly this format:\n\nABOUT: one sentence describing what the thread is about.\n\nIDEAS:\n- first main idea\n- second main idea\n- (more if the thread is deep, fewer if it is shallow)\n\nBe proportional. Short threads get 2-3 ideas. Deep threads get up to 6. No extra prose.';

const textOf = (content: unknown): string => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text).join(' ') : '');

/** app.js:2751: the conversation, then each branch under "--- Branches ---". */
export function summaryTranscript(thread: PersistedThread): string {
  const msgs = (thread.mainMessages ?? []) as Array<{ role: string; content: unknown }>;
  let convo = msgs.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${textOf(m.content)}`).join('\n\n');
  const snaps = Object.values(thread.branchSnapshots ?? {});
  if (snaps.length) {
    convo += '\n\n--- Branches ---';
    snaps.forEach((snap, i) => {
      const body = (Array.isArray(snap.messages) ? snap.messages : [])
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${typeof m.content === 'string' ? m.content : ''}`).join('\n\n');
      convo += `\n\nBranch ${i + 1} (from: "${(snap.quote || '').slice(0, 80)}"):\n${body}`;
    });
  }
  return convo;
}

interface SummaryStore {
  text: Record<string, string>;
  busy: Record<string, boolean>;
  error: Record<string, string | undefined>;
  set(id: string, patch: { text?: string; busy?: boolean; error?: string | undefined }): void;
}

export const useSummaryStore = create<SummaryStore>(set => ({
  text: {}, busy: {}, error: {},
  set: (id, p) => set(s => ({
    text: p.text === undefined ? s.text : { ...s.text, [id]: p.text },
    busy: p.busy === undefined ? s.busy : { ...s.busy, [id]: p.busy },
    error: 'error' in p ? { ...s.error, [id]: p.error } : s.error,
  })),
}));

export async function summarizeThread(id: string, thread: PersistedThread): Promise<void> {
  const store = useSummaryStore.getState();
  const key = readApiKeys().deepseek;
  if (!key) { store.set(id, { error: 'No DeepSeek API key — add it in Settings.' }); return; }
  store.set(id, { busy: true, error: undefined, text: '' });
  let acc = '';
  try {
    const signal = new AbortController().signal;
    const res = await loggedFetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash', max_tokens: 400, stream: true, thinking: { type: 'disabled' },
        messages: [{ role: 'system', content: SUMMARY_SYSTEM_PROMPT }, { role: 'user', content: `Summarize this thread:\n\n${summaryTranscript(thread)}` }],
      }),
    }, { provider: 'deepseek', label: 'chat:summary', timeoutMs: MODEL_CONNECT_TIMEOUT_MS });
    if (!res.ok) {
      const err = await readLoggedErrorPayload(res, { provider: 'deepseek', label: 'chat:summary' });
      throw new Error(err.error?.message || `DeepSeek error ${res.status}`);
    }
    for await (const raw of sseData(res, signal, 'DeepSeek summary')) {
      try {
        const delta = (JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
        if (delta) { acc += delta; useSummaryStore.getState().set(id, { text: acc }); }
      } catch { /* a malformed event is skipped, as in legacy */ }
    }
    useSummaryStore.getState().set(id, { busy: false });
  } catch (e) {
    useSummaryStore.getState().set(id, { busy: false, text: '', error: e instanceof Error ? e.message : 'Summarization failed.' });
  }
}
