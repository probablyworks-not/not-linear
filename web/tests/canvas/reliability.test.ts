import { describe, expect, it } from 'vitest';
import { structureReply } from '../../src/canvas/view/structure-reply';
import { renderMarkdown } from '../../src/lib/markdown';
import { contentText, sourceRange } from '../../src/canvas/view/selection-source';
import { applyHighlights } from '../../src/canvas/view/apply-highlights';
import { cardWheel } from '../../src/canvas/view/wheel';
import { addMessage, createRootThread, freezeSelection, textPart } from '../../src/canvas/domain/commands';
import { highlightsByMessage, resolveAnchor } from '../../src/canvas/anchors';
import { emptyDoc } from '../../src/canvas/types';

describe('source mapping and provenance', () => {
  it('maps a readable selection through Markdown syntax without losing the raw span', () => {
    const raw = 'alpha **beta** gamma';
    expect(sourceRange(raw, 'alpha beta gamma')).toEqual({ start: 0, end: raw.length });
    const doc = emptyDoc({ id: 'cv', projectId: null, title: 'T', rev: 1, counts: { threads: 0, messages: 0, outputs: 0 }, createdAt: 1, updatedAt: 1 });
    const ctx = { now: 1 };
    const { thread } = createRootThread(doc, 'Q', ctx);
    const msg = addMessage(doc, { threadId: thread.id, author: { kind: 'model', provider: 'p', model: 'm' }, parts: [textPart(raw)] }, ctx);
    const snap = freezeSelection(doc, msg.id, msg.parts[0]!.id, 'alpha beta gamma', 0, ctx, raw.length)!;
    expect(snap.content).toBe('alpha beta gamma');
    expect(snap.anchor).toMatchObject({ quote: raw, start: 0, end: raw.length });
    expect(resolveAnchor(snap, JSON.parse(JSON.stringify(doc)))).toMatchObject({ status: 'ok', frozen: 'alpha beta gamma' });
    expect(highlightsByMessage(doc)[msg.id]![msg.parts[0]!.id]![0]).toMatchObject({ quote: snap.content, start: 0 });
  });
  it('maps entities and HTML formatting, ignoring scripts/styles', () => {
    const raw = '<style>alpha beta</style><p>alpha <b>beta</b> &amp; gamma</p><script>alpha beta</script>';
    const span = sourceRange(raw, 'alpha beta & gamma', 0, true)!;
    expect(raw.slice(span.start, span.end)).toBe('alpha <b>beta</b> &amp; gamma');
  });
  it('anchors the second occurrence, including when formatting differs', () => {
    const raw = 'echo then **echo**';
    expect(sourceRange(raw, 'echo', 1)).toEqual({ start: 12, end: 16 });
  });
  it('maps named Markdown links without including their hidden destination', () => {
    const raw = 'See [Read more](https://example.com/article) now';
    const span = sourceRange(raw, 'Read more')!;
    expect(raw.slice(span.start, span.end)).toBe('Read more');
  });
  it('ignores head/control text and handles quoted angle brackets in HTML attributes', () => {
    const raw = '<head><title>echo</title></head><body><button>echo</button><p title="x > y">echo then <b>echo</b></p></body>';
    const span = sourceRange(raw, 'echo', 1, true)!;
    expect(span.start).toBe(raw.lastIndexOf('echo'));
  });
  it('maps a selection spanning paragraphs to its original source span', () => {
    const raw = 'alpha\n\nbeta';
    const span = sourceRange(raw, 'alpha\nbeta')!;
    expect(raw.slice(span.start, span.end)).toBe(raw);
  });
  it('maps the actual structured callout DOM rather than its pre-structure punctuation', () => {
    const raw = "WHO IT'S FOR: Founders\nUseful context";
    const root = document.createElement('div'); root.innerHTML = renderMarkdown(raw); structureReply(root);
    const quote = contentText(root).trim();
    const span = sourceRange(raw, quote, 0, false, root)!;
    expect(raw.slice(span.start, span.end)).toBe(raw);
  });
  it('does not guess when rendered text is absent', () => {
    expect(sourceRange('alpha', 'missing')).toBeNull();
  });
  it('excludes interactive and navigation decoration from frozen content', () => {
    const root = document.createElement('div'); root.innerHTML = '<button>Copy</button><span data-canvas-decoration>01</span>alpha <b>beta</b>';
    expect(contentText(root)).toBe('alpha beta');
  });
});

describe('precise highlight rendering', () => {
  it('marks a quote across inline formatting and reconciles removal', () => {
    const root = document.createElement('div'); root.innerHTML = 'alpha <b>beta</b> gamma';
    const highlights = [{ id: 's', partId: 'p', quote: 'alpha beta gamma', tone: 'blue' as const, start: 0 }];
    applyHighlights(root, highlights, 'alpha **beta** gamma');
    expect(root.querySelectorAll('mark')).toHaveLength(3);
    expect(root.querySelector('b')?.textContent).toBe('beta');
    applyHighlights(root, highlights, 'alpha **beta** gamma');
    expect(root.querySelectorAll('mark')).toHaveLength(3);
    applyHighlights(root, []);
    expect(root.innerHTML).toBe('alpha <b>beta</b> gamma');
  });
  it('marks the selected repeated occurrence, not the first', () => {
    const root = document.createElement('div'); root.innerHTML = 'echo then <b>echo</b>';
    applyHighlights(root, [{ id: 's', partId: 'p', quote: 'echo', start: 12, tone: 'blue' }], 'echo then **echo**');
    expect(root.querySelector('b mark')?.textContent).toBe('echo');
    expect(root.firstChild?.textContent).toBe('echo then ');
  });
});

describe('card scroll ownership', () => {
  it('lets an unscrollable card and a card at its edge hand scrolling to the scene', () => {
    const parent = document.createElement('div'), body = document.createElement('div'); parent.append(body);
    let seen = 0; parent.addEventListener('wheel', () => seen++);
    Object.defineProperties(body, { clientHeight: { value: 100 }, scrollHeight: { value: 300 } });
    body.addEventListener('wheel', e => cardWheel(body, e));
    body.scrollTop = 0;
    body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -50 }));
    expect(seen).toBe(1);
    body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 50 }));
    expect(seen).toBe(1);
    body.scrollTop = 200;
    body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 50 }));
    expect(seen).toBe(2);
    body.scrollTop = 100;
    body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 50, ctrlKey: true }));
    expect(seen).toBe(3);
  });
});
