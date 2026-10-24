import { blockNoteToLegacy, legacyToBlockNote } from './convert';
import { inlineToHtml } from './inline';
import type {
  BNBlock, BNInline, BNProps, BNTableContent, BNWrapped, InlineStyles, LegacyBlock, Sidecar,
} from './types';

// Between the converter's model and what a BlockNote editor takes and returns. The model was
// shaped to match, so this is mostly structural; the three real differences are:
//  - a line break is "\n" in BlockNote text but a `br` node here (typed Shift+Enter becomes <br>),
//  - a link with `target`/`rel` has no home in BlockNote, so it travels as `raw`,
//  - a table cell is `{ type: 'tableCell', content }` in BlockNote, a bare inline array here.

export interface EditorInline { type: string; text?: string; styles?: Record<string, unknown>; props?: BNProps; content?: unknown; href?: string }
export interface EditorBlock { id: string; type: string; props: BNProps; content?: unknown; children: EditorBlock[] }

const STYLE_KEYS: (keyof InlineStyles)[] = ['bold', 'italic', 'underline', 'strike', 'code', 'textColor', 'highlight'];

function wrappedToEditor(nodes: BNWrapped[]): EditorInline[] {
  return textToEditor(nodes);
}

// ProseMirror's `code` mark excludes every other mark (a link is one too), so BlockNote throws on
// `code` + bold, or `code` inside a link.
const codeConflict = (n: BNInline): boolean => n.type === 'text' && n.styles.code === true && Object.keys(n.styles).length > 1;

function textToEditor(nodes: BNInline[]): EditorInline[] {
  const out: EditorInline[] = [];
  const push = (text: string, styles: Record<string, unknown>) => {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && JSON.stringify(prev.styles) === JSON.stringify(styles)) prev.text = (prev.text ?? '') + text;
    else out.push({ type: 'text', text, styles });
  };
  for (const n of nodes) {
    // BlockNote discards a wrapper with nothing inside it; keep it as raw rather than lose it.
    if ((n.type === 'link' || n.type === 'branchAnchor' || n.type === 'comment') && n.content.length === 0) {
      out.push({ type: 'raw', props: { html: inlineToHtml([n]) } });
      continue;
    }
    const hasCode = (c: BNInline[]) => c.some((x) => x.type === 'text' && x.styles.code === true);
    if (
      codeConflict(n) ||
      (n.type === 'link' && hasCode(n.content)) ||
      ((n.type === 'branchAnchor' || n.type === 'comment') && n.content.some(codeConflict))
    ) {
      out.push({ type: 'raw', props: { html: inlineToHtml([n]) } });
      continue;
    }
    switch (n.type) {
      case 'text': push(n.text, { ...n.styles }); break;
      case 'br': push('\n', {}); break;
      case 'link':
        if (n.target !== undefined || n.rel !== undefined) out.push({ type: 'raw', props: { html: inlineToHtml([n]) } });
        else out.push({ type: 'link', href: n.href, content: wrappedToEditor(n.content) });
        break;
      case 'branchAnchor': out.push({ type: 'branchAnchor', props: { bid: n.bid }, content: wrappedToEditor(n.content) }); break;
      case 'comment': out.push({ type: 'comment', props: { cid: n.cid }, content: wrappedToEditor(n.content) }); break;
      case 'inlineEq': out.push({ type: 'inlineEq', props: { tex: n.tex, inner: n.inner, error: n.error } }); break;
      case 'mention': out.push({ type: 'mention', props: { kind: n.kind, id: n.id, text: n.text } }); break;
      case 'raw': out.push({ type: 'raw', props: { html: n.html } }); break;
    }
  }
  return out;
}

function contentToEditor(c: BNBlock['content']): unknown {
  if (c === undefined) return undefined;
  if (Array.isArray(c)) return textToEditor(c);
  return {
    type: 'tableContent',
    rows: c.rows.map((r) => ({ cells: r.cells.map((cell) => ({ type: 'tableCell', props: {}, content: textToEditor(cell) })) })),
  };
}

function blockToEditor(b: BNBlock): EditorBlock {
  const out: EditorBlock = { id: b.id, type: b.type, props: { ...b.props }, children: b.children.map(blockToEditor) };
  const content = contentToEditor(b.content);
  if (content !== undefined) out.content = content;
  return out;
}

export function toEditorBlocks(blocks: BNBlock[]): EditorBlock[] {
  return blocks.map(blockToEditor);
}

// ---- editor -> model ---------------------------------------------------------------

function stylesFromEditor(s: Record<string, unknown> | undefined): InlineStyles {
  const out: InlineStyles = {};
  for (const k of STYLE_KEYS) {
    const v = s?.[k];
    if (v === undefined || v === false) continue;
    if (k === 'textColor' || k === 'highlight') { if (typeof v === 'string' && v !== '') out[k] = v; } else out[k] = true;
  }
  return out;
}

function textFromEditor(text: string, styles: InlineStyles): BNInline[] {
  const parts = text.split('\n');
  const out: BNInline[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push({ type: 'br' });
    if (part !== '') out.push({ type: 'text', text: part, styles: { ...styles } });
  });
  return out;
}

function wrappedFromEditor(content: unknown): BNWrapped[] {
  return inlineFromEditor(content).filter((n): n is BNWrapped => n.type === 'text' || n.type === 'br');
}

function inlineFromEditor(content: unknown): BNInline[] {
  if (!Array.isArray(content)) return [];
  const out: BNInline[] = [];
  for (const raw of content as EditorInline[]) {
    const p = raw.props ?? {};
    switch (raw.type) {
      case 'text': out.push(...textFromEditor(raw.text ?? '', stylesFromEditor(raw.styles))); break;
      case 'link': out.push({ type: 'link', href: raw.href ?? '', content: wrappedFromEditor(raw.content) }); break;
      case 'branchAnchor': out.push({ type: 'branchAnchor', bid: String(p.bid ?? ''), content: wrappedFromEditor(raw.content) }); break;
      case 'comment': out.push({ type: 'comment', cid: String(p.cid ?? ''), content: wrappedFromEditor(raw.content) }); break;
      case 'inlineEq': out.push({ type: 'inlineEq', tex: String(p.tex ?? ''), inner: String(p.inner ?? ''), error: p.error === true }); break;
      case 'mention': out.push({ type: 'mention', kind: String(p.kind ?? ''), id: String(p.id ?? ''), text: String(p.text ?? '') }); break;
      case 'raw': out.push({ type: 'raw', html: String(p.html ?? '') }); break;
    }
  }
  return mergeAdjacent(out);
}

function sameStyles(a: InlineStyles, b: InlineStyles): boolean {
  const ka = Object.keys(a) as (keyof InlineStyles)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
function mergeAdjacent(nodes: BNInline[]): BNInline[] {
  const out: BNInline[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && n.type === 'text' && sameStyles(prev.styles, n.styles)) out[out.length - 1] = { ...prev, text: prev.text + n.text };
    else out.push(n);
  }
  return out;
}

function tableFromEditor(c: unknown): BNTableContent {
  const rows = (c as { rows?: { cells?: unknown[] }[] }).rows ?? [];
  return {
    type: 'tableContent',
    rows: rows.map((r) => ({
      cells: (r.cells ?? []).map((cell) => inlineFromEditor(Array.isArray(cell) ? cell : (cell as { content?: unknown }).content)),
    })),
  };
}

// Their text is plain, so a newline is a character, not a line-break node.
const PLAIN_TYPES = new Set(['codeBlock', 'equation']);

function plainFromEditor(content: unknown): BNInline[] {
  const text = Array.isArray(content) ? (content as EditorInline[]).map((n) => (n.type === 'text' ? n.text ?? '' : '')).join('') : '';
  return text === '' ? [] : [{ type: 'text', text, styles: {} }];
}

function blockFromEditor(b: EditorBlock): BNBlock {
  const out: BNBlock = { id: b.id, type: b.type, props: { ...b.props }, children: (b.children ?? []).map(blockFromEditor) };
  if (PLAIN_TYPES.has(b.type)) out.content = plainFromEditor(b.content);
  else if (b.type === 'table') out.content = tableFromEditor(b.content ?? {});
  else if (b.content !== undefined && Array.isArray(b.content)) out.content = inlineFromEditor(b.content);
  return out;
}

export function fromEditorBlocks(blocks: EditorBlock[]): BNBlock[] {
  return blocks.map(blockFromEditor);
}

// ---- whole pipeline --------------------------------------------------------------------

/** Everything needed to turn the editor's content back into the legacy shape. */
export interface NoteSession {
  sidecar: Sidecar;
  knownIds: ReadonlySet<string>;
  originals: Record<string, unknown>;
  /** Per block id: its content as it stood right after the editor loaded. */
  baseline: Map<string, string>;
}

export interface LoadedNote { editorBlocks: EditorBlock[]; session: NoteSession }

export function loadNoteBlocks(legacy: unknown[]): LoadedNote {
  const { blocks, sidecar, originals } = legacyToBlockNote(legacy);
  const knownIds = new Set<string>();
  const walk = (bs: BNBlock[]) => bs.forEach((b) => { knownIds.add(b.id); walk(b.children); });
  walk(blocks);
  return { editorBlocks: toEditorBlocks(blocks), session: { sidecar, knownIds, originals, baseline: new Map() } };
}

/**
 * Call once with the editor's document right after it has loaded the note. BlockNote normalises
 * what it is given, so "unchanged" has to be measured against what it holds, not what we sent.
 */
export function captureBaseline(session: NoteSession, loaded: EditorBlock[]): void {
  session.baseline.clear();
  const walk = (bs: BNBlock[]) => bs.forEach((b) => { session.baseline.set(b.id, JSON.stringify(b)); walk(b.children); });
  walk(fromEditorBlocks(loaded));
}

function isEmptyParagraph(b: BNBlock): boolean {
  return b.type === 'paragraph' && b.children.length === 0 && (!Array.isArray(b.content) || b.content.length === 0);
}

/**
 * Editor content -> legacy blocks. A block that has not changed since load is returned as the
 * original legacy block, byte for byte; only edited blocks are re-serialised. BlockNote also
 * keeps an empty paragraph at the end: one the note never had is dropped.
 */
export function saveNoteBlocks(editorBlocks: EditorBlock[], session: NoteSession): LegacyBlock[] {
  const bn = fromEditorBlocks(editorBlocks);
  while (bn.length > 0 && isEmptyParagraph(bn[bn.length - 1]!) && !session.knownIds.has(bn[bn.length - 1]!.id)) bn.pop();
  const unchanged = (b: BNBlock): LegacyBlock | undefined => {
    const was = session.baseline.get(b.id);
    if (was === undefined || was !== JSON.stringify(b) || !(b.id in session.originals)) return undefined;
    return JSON.parse(JSON.stringify(session.originals[b.id])) as LegacyBlock;
  };
  return blockNoteToLegacy(bn, session.sidecar, unchanged);
}
