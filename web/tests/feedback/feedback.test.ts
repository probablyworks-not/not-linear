import { annotationColor, canvasPoint, redraw, strokeWidth, type Ctx2D, type Stroke } from '../../src/feedback/annotate';
import {
  addPreview, closePanel, discardPreview, doShot, openPanel, removeMedia, resetFeedbackForTests, saveFeedback,
  setText, setType, startRec, stopRec, togglePanel, useFeedbackStore,
} from '../../src/feedback/feedback-store';

vi.mock('../../src/ui/toast', () => ({ toast: vi.fn() }));
import { toast } from '../../src/ui/toast';

// ---- annotation maths (core/feedback.js:244-266) ----------------------------
describe('canvasPoint', () => {
  it('scales viewport pixels to canvas pixels when the canvas is displayed smaller than its resolution', () => {
    const rect = { left: 100, top: 50, width: 500, height: 250 };
    expect(canvasPoint(rect, { width: 2000, height: 1000 }, 350, 175)).toEqual({ x: 1000, y: 500 });
    expect(canvasPoint(rect, { width: 2000, height: 1000 }, 100, 50)).toEqual({ x: 0, y: 0 });
  });
  it('is the identity at 1:1', () => {
    expect(canvasPoint({ left: 0, top: 0, width: 400, height: 300 }, { width: 400, height: 300 }, 123, 45)).toEqual({ x: 123, y: 45 });
  });
  it('a hidden (zero-size) canvas maps to the origin instead of NaN', () => {
    expect(canvasPoint({ left: 0, top: 0, width: 0, height: 0 }, { width: 400, height: 300 }, 10, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe('strokeWidth', () => {
  it('never thinner than 3 and grows with the image', () => {
    expect(strokeWidth(800)).toBe(3);
    expect(strokeWidth(1500)).toBe(3);
    expect(strokeWidth(2500)).toBe(5);
    expect(strokeWidth(5000)).toBe(10);
  });
});

describe('redraw', () => {
  function fakeCtx() {
    const calls: string[] = [];
    const ctx = {
      clearRect: (...a: number[]) => calls.push(`clear ${a.join(',')}`),
      drawImage: (_i: unknown, x: number, y: number) => calls.push(`image ${x},${y}`),
      beginPath: () => calls.push('begin'),
      moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
      stroke: () => calls.push('stroke'),
      strokeStyle: '', lineWidth: 0, lineCap: 'butt', lineJoin: 'miter',
    } as unknown as Ctx2D;
    return { ctx, calls };
  }
  it('repaints the image first, then each stroke as a polyline, in the annotation colour', () => {
    const { ctx, calls } = fakeCtx();
    const strokes: Stroke[] = [[{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], [{ x: 9, y: 9 }]];
    redraw(ctx, { width: 1000, height: 500 }, {} as CanvasImageSource, strokes, 'rgb(1,2,3)');
    expect(calls).toEqual(['clear 0,0,1000,500', 'image 0,0', 'begin', 'move 1,2', 'line 3,4', 'line 5,6', 'stroke', 'begin', 'move 9,9', 'stroke']);
    expect(ctx.strokeStyle).toBe('rgb(1,2,3)');
    expect(ctx.lineCap).toBe('round');
    expect(ctx.lineJoin).toBe('round');
    expect(ctx.lineWidth).toBe(3);
  });
  it('with no strokes it only repaints the image (Clear)', () => {
    const { ctx, calls } = fakeCtx();
    redraw(ctx, { width: 10, height: 10 }, {} as CanvasImageSource, [], 'red');
    expect(calls).toEqual(['clear 0,0,10,10', 'image 0,0']);
  });
});

describe('annotationColor', () => {
  it('reads the --annotate token, and falls back to something drawable', () => {
    document.documentElement.style.setProperty('--annotate', ' #E5534B ');
    expect(annotationColor()).toBe('#E5534B');
    document.documentElement.style.removeProperty('--annotate');
    expect(annotationColor()).toBe('red');
  });
});

// ---- actions and their wording ---------------------------------------------
type Json = Record<string, unknown>;
let sent: Array<{ url: string; body: Json; headers: Record<string, string> }> = [];
function server(handler: (url: string, body: Json) => unknown | Promise<unknown>) {
  sent = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    sent.push({ url: String(url), body, headers: init?.headers as Record<string, string> });
    const out = await handler(String(url), body);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  });
}
const toasted = () => (toast as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);

beforeEach(() => { resetFeedbackForTests(); (toast as unknown as ReturnType<typeof vi.fn>).mockClear(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('panel', () => {
  it('opens, toggles, and refuses to close mid-recording', () => {
    togglePanel();
    expect(useFeedbackStore.getState().open).toBe(true);
    togglePanel();
    expect(useFeedbackStore.getState().open).toBe(false);
    openPanel();
    useFeedbackStore.setState({ recording: true });
    closePanel();
    expect(useFeedbackStore.getState().open).toBe(true);
    expect(toasted()).toEqual(['Recording still running — stop it first']);
  });
  it('the draft survives closing, and media can be removed from the entry', () => {
    openPanel(); setText('half a bug'); setType('idea');
    useFeedbackStore.setState({ media: ['feedback/media/a.png', 'feedback/media/b.mov'] });
    closePanel();
    expect(useFeedbackStore.getState()).toMatchObject({ text: 'half a bug', type: 'idea', open: false });
    removeMedia(0);
    expect(useFeedbackStore.getState().media).toEqual(['feedback/media/b.mov']);
  });
});

describe('screenshot', () => {
  it('hides the panel, waits for it to paint, captures, then opens the preview', async () => {
    vi.useFakeTimers();
    server(() => ({ ok: true, path: 'feedback/media/s1.png' }));
    const p = doShot('area');
    expect(useFeedbackStore.getState()).toMatchObject({ capturing: true, shotBusy: true });
    expect(sent).toHaveLength(0); // not yet: the hide must paint first
    await vi.advanceTimersByTimeAsync(250);
    await p;
    expect(sent[0]).toMatchObject({ url: '/__notlinear_feedback_shot', body: { mode: 'area' } });
    expect(sent[0]!.headers['X-Notlinear-Local']).toBe('1');
    expect(useFeedbackStore.getState()).toMatchObject({ capturing: false, shotBusy: false, preview: { kind: 'image', path: 'feedback/media/s1.png' } });
  });
  it.each([
    ['a cancelled area select says nothing', { ok: false, cancelled: true }, []],
    ['a server error shows its message', { ok: false, error: 'No permission' }, ['No permission']],
    ['an error with no message', { ok: false }, ['Screenshot failed']],
  ])('%s', async (_n, reply, expected) => {
    vi.useFakeTimers();
    server(() => reply);
    const p = doShot('full');
    await vi.advanceTimersByTimeAsync(250);
    await p;
    expect(toasted()).toEqual(expected);
    expect(useFeedbackStore.getState()).toMatchObject({ capturing: false, preview: null });
  });
  it('an unreachable server un-hides the panel and says so', async () => {
    vi.useFakeTimers();
    server(() => new TypeError('Failed to fetch'));
    const p = doShot('full');
    await vi.advanceTimersByTimeAsync(250);
    await p;
    expect(toasted()).toEqual(['Screenshot failed — is the server running?']);
    expect(useFeedbackStore.getState()).toMatchObject({ capturing: false, shotBusy: false });
  });
});

describe('recording', () => {
  it('start: marks recording; an area recording tells you to drag', async () => {
    server(() => ({ ok: true }));
    await startRec('area');
    expect(useFeedbackStore.getState()).toMatchObject({ recording: true, recBusy: false });
    expect(sent[0]).toMatchObject({ url: '/__notlinear_feedback_record', body: { action: 'start', mode: 'area' } });
    expect(toasted()).toEqual(['Drag to select the area — recording starts on release']);
  });
  it('start in full-screen mode shows no toast', async () => {
    server(() => ({ ok: true }));
    await startRec('full');
    expect(toasted()).toEqual([]);
  });
  it.each([
    [{ ok: false, error: 'busy' }, 'busy'],
    [{ ok: false }, 'Could not start recording'],
  ])('a failed start %j shows %s and does not record', async (reply, text) => {
    server(() => reply);
    await startRec('full');
    expect(toasted()).toEqual([text]);
    expect(useFeedbackStore.getState().recording).toBe(false);
  });
  it('stop: opens a video preview', async () => {
    server(() => ({ ok: true, path: 'feedback/media/r1.mov' }));
    useFeedbackStore.setState({ recording: true });
    await stopRec();
    expect(sent[0]!.body).toEqual({ action: 'stop' });
    expect(useFeedbackStore.getState()).toMatchObject({ recording: false, preview: { kind: 'video', path: 'feedback/media/r1.mov' } });
  });
  it.each([
    [{ ok: false, cancelled: true }, 'No recording captured'],
    [{ ok: false, error: 'disk full' }, 'disk full'],
    [{ ok: false }, 'Recording failed'],
  ])('a stop that yields %j shows %s', async (reply, text) => {
    server(() => reply);
    useFeedbackStore.setState({ recording: true });
    await stopRec();
    expect(toasted()).toEqual([text]);
    expect(useFeedbackStore.getState().recording).toBe(false);
  });
  it('a dead server still ends the recording state, so the button cannot stick on Stop', async () => {
    server(() => new TypeError('x'));
    useFeedbackStore.setState({ recording: true });
    await stopRec();
    expect(useFeedbackStore.getState()).toMatchObject({ recording: false, recBusy: false });
    expect(toasted()).toEqual(['Recording failed — is the server running?']);
  });
});

describe('preview: Add and Discard', () => {
  const pv = { kind: 'image' as const, path: 'feedback/media/s.png' };
  it('Add without annotations attaches the path and uploads nothing', async () => {
    server(() => ({ ok: true }));
    useFeedbackStore.setState({ preview: pv });
    await addPreview(null);
    expect(sent).toHaveLength(0);
    expect(useFeedbackStore.getState()).toMatchObject({ media: [pv.path], preview: null });
  });
  it('Add with annotations uploads the flattened PNG first, then attaches', async () => {
    server(() => ({ ok: true }));
    useFeedbackStore.setState({ preview: pv });
    await addPreview('BASE64PNG');
    expect(sent[0]).toMatchObject({ url: '/__notlinear_feedback_upload', body: { path: pv.path, base64: 'BASE64PNG' } });
    expect(useFeedbackStore.getState().media).toEqual([pv.path]);
  });
  it('a failed upload attaches nothing and keeps the preview open', async () => {
    server(() => ({ ok: false, error: 'read-only disk' }));
    useFeedbackStore.setState({ preview: pv });
    await addPreview('X');
    expect(toasted()).toEqual(['read-only disk']);
    expect(useFeedbackStore.getState()).toMatchObject({ media: [], preview: pv });
  });
  it('an upload error with no message, and an unreachable server, use the legacy wording', async () => {
    server(() => ({ ok: false }));
    useFeedbackStore.setState({ preview: pv });
    await addPreview('X');
    server(() => new TypeError('x'));
    await addPreview('X');
    expect(toasted()).toEqual(['Could not save annotations', 'Could not save — is the server running?']);
  });
  it('Discard closes at once and asks the server to delete the file', async () => {
    server(() => ({ ok: true }));
    useFeedbackStore.setState({ preview: pv });
    await discardPreview();
    expect(sent[0]).toMatchObject({ url: '/__notlinear_feedback_discard', body: { path: pv.path } });
    expect(useFeedbackStore.getState()).toMatchObject({ preview: null, media: [] });
  });
  it('Discard closes even when the server cannot be reached', async () => {
    server(() => new TypeError('x'));
    useFeedbackStore.setState({ preview: pv });
    await discardPreview();
    expect(useFeedbackStore.getState().preview).toBeNull();
  });
});

describe('save', () => {
  it('refuses an empty report', async () => {
    server(() => ({ ok: true }));
    setText('   ');
    await saveFeedback();
    expect(toasted()).toEqual(['Nothing to save yet']);
    expect(sent).toHaveLength(0);
  });
  it('allows media with no text', async () => {
    server(() => ({ ok: true, id: 'B-1', path: 'feedback/FEEDBACK.md' }));
    useFeedbackStore.setState({ media: ['feedback/media/a.png'] });
    await saveFeedback();
    expect(sent).toHaveLength(1);
  });
  it('refuses while recording', async () => {
    server(() => ({ ok: true }));
    setText('x');
    useFeedbackStore.setState({ recording: true });
    await saveFeedback();
    expect(toasted()).toEqual(['Stop the recording first']);
    expect(sent).toHaveLength(0);
  });
  it('sends the type, trimmed text, media and where it was filed; then clears the draft and bumps the log', async () => {
    server(() => ({ ok: true, id: 'B-007', path: 'feedback/FEEDBACK.md' }));
    setType('idea'); setText('  Make it purple  ');
    useFeedbackStore.setState({ media: ['feedback/media/a.png'] });
    await saveFeedback();
    expect(sent[0]).toMatchObject({
      url: '/__notlinear_feedback_save',
      body: { type: 'idea', text: 'Make it purple', media: ['feedback/media/a.png'], context: { view: 'chat', thread: 'doc-main' } },
    });
    expect(toasted()).toEqual(['Saved B-007 → feedback/FEEDBACK.md']);
    expect(useFeedbackStore.getState()).toMatchObject({ text: '', media: [], logVersion: 1, saving: false });
  });
  it.each([
    [{ ok: false, error: 'locked' }, 'locked'],
    [{ ok: false }, 'Save failed'],
  ])('a rejected save %j keeps the draft and shows %s', async (reply, text) => {
    server(() => reply);
    setText('keep me');
    await saveFeedback();
    expect(toasted()).toEqual([text]);
    expect(useFeedbackStore.getState()).toMatchObject({ text: 'keep me', saving: false, logVersion: 0 });
  });
  it('an unreachable server keeps the draft and says so', async () => {
    server(() => new TypeError('x'));
    setText('keep me');
    await saveFeedback();
    expect(toasted()).toEqual(['Save failed — is the server running?']);
    expect(useFeedbackStore.getState().text).toBe('keep me');
  });
});
