// Highlights and branch anchors as pure DOM and string work: no React, no store.
//
// Legacy marks text by wrapping it in `<span class="highlighted" data-hid>` or
// `<span class="branched" data-bid>`, and the saved HTML is the only record of
// where. `highlightsV2` (ADR-038) adds a structured record, `{ id, kind, start,
// end, text }`, with offsets into the container's plain text. Offsets are over
// `textContent`, which wrapping never changes, so they survive re-renders.
//
// The `splitText` dance in wrapRangeTextSegments is load-bearing for a selection
// that crosses several text nodes (it is app.js:604-620, kept near-verbatim), and
// whitespace-only text nodes are deliberately never wrapped, as in legacy.

export type MarkKind = 'highlight' | 'branch';

/** One contiguous stretch of marked text. Offsets are into the container's textContent, `end` exclusive. */
export interface Run {
  start: number;
  end: number;
  /** The text when it was marked: lets a stale offset be noticed. */
  text: string;
}

/**
 * A highlight or branch anchor. It has several runs because real data has them:
 * one id can sit on pieces of text with unmarked words between (a branch quote
 * that legacy re-wrapped in another place), and joining them into one span would
 * mark the words in between.
 */
export interface MarkSpec {
  id: string;
  kind: MarkKind;
  runs: Run[];
}

export interface Anchor { start: number; end: number; text: string }
export interface TextSegment { node: Text; start: number; end: number }

const KIND_ATTR: Record<MarkKind, { className: string; dataKey: 'hid' | 'bid' }> = {
  highlight: { className: 'highlighted', dataKey: 'hid' },
  branch: { className: 'branched', dataKey: 'bid' },
};
const MARK_SELECTOR = '.highlighted[data-hid], .branched[data-bid]';

/** app.js:579 selectedTextSegments. */
export function selectedTextSegments(range: Range): TextSegment[] {
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      try {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } catch {
        return NodeFilter.FILTER_REJECT;
      }
    },
  });
  const segments: TextSegment[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.nodeValue!.length;
    if (start < end) segments.push({ node, start, end });
  }
  return segments;
}

/** app.js:604 wrapRangeTextSegments. Returns the id used; throws when nothing is selected. */
export function wrapRangeTextSegments(range: Range, opts: { className: string; datasetKey: string; id: string }): string {
  const segments = selectedTextSegments(range);
  if (!segments.length) throw new Error('No selected text to wrap');
  for (const { node, start, end } of segments) {
    const parent = node.parentNode;
    if (!parent) continue;
    let selected = node;
    if (end < selected.nodeValue!.length) selected.splitText(end);
    if (start > 0) selected = selected.splitText(start);
    const span = document.createElement('span');
    span.className = opts.className;
    span.dataset[opts.datasetKey] = opts.id;
    parent.insertBefore(span, selected);
    span.appendChild(selected);
  }
  return opts.id;
}

export function makeHighlightId(): string {
  return 'hl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function makeBranchId(): string {
  return 'b' + Date.now();
}

// ---------- offsets ----------

/** Number of text characters in `container` before the point (node, offset). */
function textOffsetBefore(container: Node, node: Node, offset: number): number {
  const probe = document.createRange();
  probe.selectNodeContents(container);
  probe.setEnd(node, offset);
  return probe.toString().length;
}

/** The selection as offsets into `container`, or null when it is empty or outside the container. */
export function rangeToAnchor(container: Element, range: Range): Anchor | null {
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const start = textOffsetBefore(container, range.startContainer, range.startOffset);
  const end = textOffsetBefore(container, range.endContainer, range.endOffset);
  if (end <= start) return null;
  return { start, end, text: (container.textContent ?? '').slice(start, end) };
}

/** The inverse: a Range covering [start, end) of the container's text, or null if out of bounds. */
export function anchorToRange(container: Element, start: number, end: number): Range | null {
  if (start < 0 || end <= start) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let haveStart = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.nodeValue!.length;
    if (!haveStart && start < pos + len) { range.setStart(node, start - pos); haveStart = true; }
    if (haveStart && end <= pos + len) { range.setEnd(node, end - pos); return range; }
    pos += len;
  }
  return null;
}

// ---------- marks ----------

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Removes every mark span, leaving its text, and merges the text nodes it had split. */
export function stripMarks(container: Element): void {
  container.querySelectorAll(MARK_SELECTOR).forEach(unwrap);
  container.normalize();
}

/**
 * Writes a turn's whole mark list into `container`. Idempotent: existing marks
 * are removed first, then each is wrapped from the END of the text backwards, so
 * wrapping one mark never moves the offsets of those still to come.
 *
 * A mark whose text no longer matches what is at its offsets is skipped rather
 * than wrapped around the wrong words; it is returned so the caller can say so.
 */
export function applyMarks(container: Element, marks: readonly MarkSpec[]): { skipped: MarkSpec[] } {
  stripMarks(container);
  const text = container.textContent ?? '';
  const skipped = new Map<string, MarkSpec>();
  const items = marks.flatMap(mark => mark.runs.map(run => ({ mark, run })));
  items.sort((x, y) => y.run.start - x.run.start || y.run.end - x.run.end);
  for (const { mark, run } of items) {
    const range = text.slice(run.start, run.end) === run.text ? anchorToRange(container, run.start, run.end) : null;
    const { className, dataKey } = KIND_ATTR[mark.kind];
    try {
      if (!range) throw new Error('stale');
      wrapRangeTextSegments(range, { className, datasetKey: dataKey, id: mark.id });
    } catch {
      skipped.set(`${mark.kind}:${mark.id}`, mark);
    }
  }
  return { skipped: [...skipped.values()] };
}

/**
 * What marks `container` currently holds, read from its spans. The several spans
 * legacy writes for one multi-node selection are joined into one run; spans of the
 * same id with unmarked words between them stay separate runs.
 */
export function readMarks(container: Element): MarkSpec[] {
  const full = container.textContent ?? '';
  const offsets = new Map<Node, number>();
  let pos = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    offsets.set(walker.currentNode, pos);
    pos += walker.currentNode.nodeValue!.length;
  }
  const byKey = new Map<string, { id: string; kind: MarkKind; spans: Array<[number, number]> }>();
  container.querySelectorAll<HTMLElement>(MARK_SELECTOR).forEach(el => {
    const kind: MarkKind = el.classList.contains('branched') ? 'branch' : 'highlight';
    const id = (kind === 'branch' ? el.dataset.bid : el.dataset.hid) ?? '';
    const texts = textNodesOf(el);
    if (!id || !texts.length) return;
    const last = texts[texts.length - 1]!;
    const span: [number, number] = [offsets.get(texts[0]!)!, offsets.get(last)! + last.nodeValue!.length];
    const key = `${kind}:${id}`;
    const entry = byKey.get(key) ?? { id, kind, spans: [] };
    entry.spans.push(span);
    byKey.set(key, entry);
  });
  return [...byKey.values()].map(({ id, kind, spans }) => {
    spans.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const runs: Run[] = [];
    for (const [start, end] of spans) {
      const cur = runs[runs.length - 1];
      // Touching, overlapping, or separated only by whitespace: one run.
      if (cur && (start <= cur.end || full.slice(cur.end, start).trim() === '')) cur.end = Math.max(cur.end, end);
      else runs.push({ start, end, text: '' });
    }
    for (const r of runs) r.text = full.slice(r.start, r.end);
    return { id, kind, runs };
  });
}

function textNodesOf(el: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) out.push(walker.currentNode as Text);
  return out;
}

/** Ids of the marks a piece of saved HTML holds, per kind. Cheap: no offsets. */
export function markIdsIn(html: string): { highlight: Set<string>; branch: Set<string> } {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out = { highlight: new Set<string>(), branch: new Set<string>() };
  tpl.content.querySelectorAll<HTMLElement>(MARK_SELECTOR).forEach(el => {
    if (el.dataset.hid) out.highlight.add(el.dataset.hid);
    if (el.dataset.bid) out.branch.add(el.dataset.bid);
  });
  return out;
}

/**
 * Removes the spans of the given marks from a piece of saved HTML, keeping their text
 * (app.js unwrapHighlightFromHTML / unwrapBranchAnchorsFromHTML). Returns the new HTML.
 */
export function unwrapMarksInHTML(html: string, kind: MarkKind, ids: ReadonlySet<string>): string {
  if (!html || !ids.size) return html;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const { className, dataKey } = KIND_ATTR[kind];
  holder.querySelectorAll<HTMLElement>(`.${className}[data-${dataKey}]`).forEach(el => {
    if (!ids.has(el.dataset[dataKey] ?? '')) return;
    const parent = el.parentNode;
    unwrap(el);
    parent?.normalize();
  });
  return holder.innerHTML;
}
