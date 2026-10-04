import { create } from 'zustand';
import { LOCAL_HEADER } from '../lib/api';
import { toast } from '../ui/toast';
import { getActiveViewId } from '../registry/views';
import { useAppStore } from '../state/app-store';

// State and actions for the floating Feedback panel (core/feedback.js).
//
// The draft (type, text, attached media) lives in a store, not component state,
// because closing the panel only hides it in legacy and the draft must survive
// that. Copy for every toast is carried over verbatim.

export type FeedbackType = 'bug' | 'idea';
export type CaptureMode = 'area' | 'full';
export interface Preview { kind: 'image' | 'video'; path: string }

export interface FeedbackState {
  open: boolean;
  type: FeedbackType;
  text: string;
  media: string[];            // repo-relative paths returned by the server
  recording: boolean;
  recStartedAt: number;
  capturing: boolean;         // the panel hides itself so it is not in its own screenshot
  shotBusy: boolean;
  recBusy: boolean;
  saving: boolean;
  preview: Preview | null;
  logVersion: number;         // bumped on a successful save so the Settings list refetches
}

export const useFeedbackStore = create<FeedbackState>(() => ({
  open: false, type: 'bug', text: '', media: [], recording: false, recStartedAt: 0,
  capturing: false, shotBusy: false, recBusy: false, saving: false, preview: null, logVersion: 0,
}));

const set = useFeedbackStore.setState;
const get = useFeedbackStore.getState;

/** Legacy's local POST helper: plain fetch, deliberately not the request-logged client. */
export async function post<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...LOCAL_HEADER }, body: JSON.stringify(body || {}) });
  return (await res.json()) as T;
}

interface Out { ok?: boolean; cancelled?: boolean; error?: string; path?: string; id?: string }

export function openPanel(): void { set({ open: true }); }

export function closePanel(): void {
  if (get().recording) { toast('Recording still running — stop it first'); return; }
  set({ open: false });
}

export function togglePanel(): void { if (get().open) closePanel(); else openPanel(); }

export function setType(type: FeedbackType): void { set({ type }); }
export function setText(text: string): void { set({ text }); }
export function removeMedia(i: number): void {
  // Drops it from the entry; the file stays on disk.
  set({ media: get().media.filter((_p, idx) => idx !== i) });
}

/** Where a report was filed from, shown in the panel footer and saved with the entry. */
export function currentContext(): { view: string; thread: string } {
  return { view: getActiveViewId() || 'chat', thread: useAppStore.getState().currentThreadId || '' };
}

// ---------- screenshot ----------
const tick = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function doShot(mode: CaptureMode): Promise<void> {
  set({ shotBusy: true, capturing: true });
  await tick(250); // let the hide actually paint before the OS captures the screen
  try {
    const out = await post<Out>('/__notlinear_feedback_shot', { mode });
    set({ capturing: false });
    if (out.ok && out.path) set({ preview: { kind: 'image', path: out.path } });
    else if (!out.cancelled) toast(out.error || 'Screenshot failed');
  } catch {
    set({ capturing: false });
    toast('Screenshot failed — is the server running?');
  }
  set({ shotBusy: false });
}

// ---------- recording ----------
export async function startRec(mode: CaptureMode): Promise<void> {
  set({ recBusy: true });
  try {
    const out = await post<Out>('/__notlinear_feedback_record', { action: 'start', mode });
    if (out.ok) {
      set({ recording: true, recStartedAt: Date.now() });
      if (mode === 'area') toast('Drag to select the area — recording starts on release');
    } else toast(out.error || 'Could not start recording');
  } catch { toast('Recording failed — is the server running?'); }
  set({ recBusy: false });
}

export async function stopRec(): Promise<void> {
  set({ recBusy: true });
  try {
    const out = await post<Out>('/__notlinear_feedback_record', { action: 'stop' });
    set({ recording: false });
    if (out.ok && out.path) set({ preview: { kind: 'video', path: out.path } });
    else if (out.cancelled) toast('No recording captured');
    else toast(out.error || 'Recording failed');
  } catch {
    set({ recording: false });
    toast('Recording failed — is the server running?');
  }
  set({ recBusy: false });
}

// ---------- preview: Add / Discard ----------
/**
 * "Add to report". With annotations, the flattened canvas replaces the file on
 * the server first; only after that does the path join the entry.
 */
export async function addPreview(annotatedPngBase64: string | null): Promise<void> {
  const pv = get().preview;
  if (!pv) return;
  try {
    if (annotatedPngBase64) {
      const out = await post<Out>('/__notlinear_feedback_upload', { path: pv.path, base64: annotatedPngBase64 });
      if (!out.ok) { toast(out.error || 'Could not save annotations'); return; }
    }
    set({ media: [...get().media, pv.path], preview: null });
  } catch { toast('Could not save — is the server running?'); }
}

/** Nothing attaches until Add; Discard (or Escape) deletes the just-captured file from disk. */
export async function discardPreview(): Promise<void> {
  const pv = get().preview;
  if (!pv) return;
  set({ preview: null });
  try { await post('/__notlinear_feedback_discard', { path: pv.path }); } catch { /* the file stays; nothing was attached */ }
}

// ---------- save ----------
export async function saveFeedback(): Promise<void> {
  const { text, media, type, recording } = get();
  const body = text.trim();
  if (!body && !media.length) { toast('Nothing to save yet'); return; }
  if (recording) { toast('Stop the recording first'); return; }
  set({ saving: true });
  try {
    const out = await post<Out>('/__notlinear_feedback_save', { type, text: body, media, context: currentContext() });
    if (out.ok) {
      toast(`Saved ${out.id} → ${out.path}`);
      set({ text: '', media: [], logVersion: get().logVersion + 1 });
    } else toast(out.error || 'Save failed');
  } catch { toast('Save failed — is the server running?'); }
  set({ saving: false });
}

/** Test seam. */
export function resetFeedbackForTests(): void {
  set({ open: false, type: 'bug', text: '', media: [], recording: false, recStartedAt: 0, capturing: false, shotBusy: false, recBusy: false, saving: false, preview: null, logVersion: 0 });
}
