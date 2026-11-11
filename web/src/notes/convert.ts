import { htmlToInline, inlineToHtml } from './inline';
import { FALLBACK_LANGUAGE, isSupportedCodeLanguage } from './code-languages';
import type {
  BNBlock, BNInline, BNProps, BNTableContent, Converted, LegacyBlock, Sidecar, SidecarEntry,
} from './types';

// legacyToBlockNote / blockNoteToLegacy for the blocks frontend/views/notes.js emits.
// Persistence stays in the legacy shape (ADR-007); BlockNote is only a view over it.
// Guarantees, enforced by tests: a block round-trips to deep-equal JSON (HTML fields
// to per-character equality), and anything unmodelled survives in the sidecar.

type PropKind = 'string' | 'number' | 'boolean';
type ContentKind = 'html' | 'plain' | 'none';

interface PropMap { legacy: string; bn: string; kind: PropKind; fallback: string | number | boolean }

interface Spec {
  bn: string;
  content: ContentKind;
  props: PropMap[];
  /** Pure-data blocks: every other legacy field travels as one JSON `data` prop. */
  dataBag?: boolean;
}

const str = (legacy: string, bn = legacy): PropMap => ({ legacy, bn, kind: 'string', fallback: '' });
const num = (legacy: string, bn = legacy): PropMap => ({ legacy, bn, kind: 'number', fallback: 0 });
const bool = (legacy: string, bn = legacy): PropMap => ({ legacy, bn, kind: 'boolean', fallback: false });

const SPECS: Record<string, Spec> = {
  text: { bn: 'paragraph', content: 'html', props: [] },
  h1: { bn: 'heading', content: 'html', props: [] },
  h2: { bn: 'heading', content: 'html', props: [] },
  h3: { bn: 'heading', content: 'html', props: [] },
  h4: { bn: 'heading', content: 'html', props: [] },
  bullet: { bn: 'bulletListItem', content: 'html', props: [] },
  numbered: { bn: 'numberedListItem', content: 'html', props: [] },
  todo: { bn: 'checkListItem', content: 'html', props: [bool('done', 'checked')] },
  quote: { bn: 'quote', content: 'html', props: [] },
  callout: { bn: 'callout', content: 'html', props: [str('emoji')] },
  toggle: { bn: 'toggle', content: 'html', props: [num('headingLevel'), bool('open')] },
  code: { bn: 'codeBlock', content: 'plain', props: [str('lang', 'language')] },
  eq: { bn: 'equation', content: 'plain', props: [] },
  image: { bn: 'image', content: 'none', props: [str('src', 'url'), str('caption'), num('width', 'previewWidth')] },
  'page-link': { bn: 'pageLink', content: 'none', props: [str('text', 'label'), str('target')] },
  divider: { bn: 'divider', content: 'none', props: [], dataBag: true },
  toc: { bn: 'toc', content: 'none', props: [], dataBag: true },
  media: { bn: 'media', content: 'none', props: [], dataBag: true },
  file: { bn: 'file', content: 'none', props: [], dataBag: true },
  bookmark: { bn: 'bookmark', content: 'none', props: [], dataBag: true },
  embed: { bn: 'embed', content: 'none', props: [], dataBag: true },
};
const HEADING_LEVEL: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4 };
const BN_TO_LEGACY: Record<string, string> = {};
for (const [legacy, spec] of Object.entries(SPECS)) if (spec.bn !== 'heading') BN_TO_LEGACY[spec.bn] = legacy;

const RESERVED = new Set(['id', 'type', 'children']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Ctx { sidecar: Sidecar; seen: Set<string>; counter: number; originals: Record<string, unknown> }

function entry(ctx: Ctx, id: string): SidecarEntry {
  return (ctx.sidecar[id] ??= {});
}

function plainContent(text: string): BNInline[] {
  return text === '' ? [] : [{ type: 'text', text, styles: {} }];
}
function plainOf(content: BNInline[] | BNTableContent | undefined): string {
  if (!Array.isArray(content)) return '';
  return content.map((n) => (n.type === 'text' ? n.text : '')).join('');
}

function validProps(spec: Spec, b: LegacyBlock): boolean {
  for (const p of spec.props) if (has(b, p.legacy) && typeof b[p.legacy] !== p.kind) return false;
  if (spec.content !== 'none' && has(b, 'text') && typeof b.text !== 'string') return false;
  if (has(b, 'children') && !Array.isArray(b.children)) return false;
  return true;
}

function blockToBN(b: unknown, ctx: Ctx): BNBlock {
  const raw: LegacyBlock = isRecord(b) ? b : {};
  const wantId = typeof raw.id === 'string' && raw.id !== '' ? raw.id : undefined;
  let id: string;
  let idNote = false;
  if (wantId !== undefined && !ctx.seen.has(wantId)) id = wantId;
  else { do id = `bn_${ctx.counter++}`; while (ctx.seen.has(id)); idNote = true; }
  ctx.seen.add(id);
  ctx.originals[id] = clone(b);
  if (idNote) entry(ctx, id).origId = has(raw, 'id') ? raw.id : null;

  const opaque = (type: string): BNBlock => {
    entry(ctx, id).opaque = clone(b as LegacyBlock);
    return { id, type: 'opaque', props: { legacyType: type }, children: [] };
  };

  const type = raw.type;
  if (!isRecord(b) || typeof type !== 'string') return opaque('');
  const isCols = type === 'cols';
  const spec = SPECS[type] as Spec | undefined;
  const isTable = type === 'table';
  if (!spec && !isCols && !isTable) return opaque(type);
  if (spec && !validProps(spec, raw)) return opaque(type);
  if (isTable && (has(raw, 'rows') && !(Array.isArray(raw.rows) && raw.rows.every((r) => Array.isArray(r) && r.every((c) => typeof c === 'string'))))) return opaque(type);
  // BlockNote tables are rectangular with at least one cell; anything else is kept whole.
  if (isTable) {
    const rows = raw.rows;
    const width = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0].length : 0;
    if (!Array.isArray(rows) || width === 0 || !rows.every((r) => Array.isArray(r) && r.length === width)) return opaque(type);
  }
  if (isCols && has(raw, 'cols') && !(Array.isArray(raw.cols) && raw.cols.every(Array.isArray))) return opaque(type);
  if (isCols && has(raw, 'children') && !Array.isArray(raw.children)) return opaque(type);
  if (isTable && has(raw, 'children') && !Array.isArray(raw.children)) return opaque(type);

  const known = new Set<string>(RESERVED);
  const absent: string[] = [];
  const props: BNProps = {};
  let content: BNBlock['content'];
  let bnType: string;

  if (isCols) {
    bnType = 'columns';
    known.add('cols');
    if (!has(raw, 'cols')) absent.push('cols');
  } else if (isTable) {
    bnType = 'table';
    known.add('rows');
    if (!has(raw, 'rows')) absent.push('rows');
  } else {
    if (!spec) return opaque(type);
    bnType = spec.bn;
    if (bnType === 'heading') props.level = HEADING_LEVEL[type] ?? 1;
    for (const p of spec.props) {
      known.add(p.legacy);
      if (has(raw, p.legacy)) props[p.bn] = raw[p.legacy] as string | number | boolean;
      else { props[p.bn] = p.fallback; absent.push(p.legacy); }
    }
    if (spec.content !== 'none') {
      known.add('text');
      if (!has(raw, 'text')) absent.push('text');
      const text = typeof raw.text === 'string' ? raw.text : '';
      content = spec.content === 'html' ? htmlToInline(text) : plainContent(text);
    }
    // A code block whose language the editor cannot highlight throws while it renders, which no
    // try/catch around opening the note can see. Show it as plain text and keep the original
    // `lang` in the sidecar, so the note still saves back with the language it was written in.
    if (type === 'code' && has(raw, 'lang') && !isSupportedCodeLanguage(raw.lang)) {
      props.language = FALLBACK_LANGUAGE;
      known.delete('lang');
    }
    if (spec.dataBag) {
      const bag: Record<string, unknown> = {};
      for (const k of Object.keys(raw)) if (!RESERVED.has(k)) bag[k] = raw[k];
      props.data = JSON.stringify(bag);
      for (const k of Object.keys(bag)) known.add(k);
    }
  }

  if (isTable && Array.isArray(raw.rows)) {
    content = { type: 'tableContent', rows: (raw.rows as string[][]).map((r) => ({ cells: r.map((c) => htmlToInline(c)) })) };
  }

  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!known.has(k)) extra[k] = clone(raw[k]);

  const children: BNBlock[] = [];
  if (isCols) {
    const cols = Array.isArray(raw.cols) ? (raw.cols as unknown[][]) : [];
    cols.forEach((col, ci) => {
      const colId = `${id}:col${ci}`;
      ctx.seen.add(colId);
      children.push({ id: colId, type: 'column', props: {}, children: col.map((c) => blockToBN(c, ctx)) });
    });
  }
  if (Array.isArray(raw.children)) {
    if (isCols) {
      // `children` on a cols block is legal data: keep it after the columns, tagged.
      children.push({ id: `${id}:kids`, type: 'columnsChildren', props: {}, children: (raw.children as unknown[]).map((c) => blockToBN(c, ctx)) });
    } else {
      for (const c of raw.children) children.push(blockToBN(c, ctx));
    }
  } else if (!has(raw, 'children')) absent.push('children');

  const e = entry(ctx, id);
  if (absent.length) e.absent = absent;
  if (Object.keys(extra).length) e.extra = extra;
  if (!e.absent && !e.extra && e.origId === undefined && !has(e, 'opaque')) delete ctx.sidecar[id];

  const out: BNBlock = { id, type: bnType, props, children };
  if (content !== undefined) out.content = content;
  return out;
}

export function legacyToBlockNote(blocks: unknown[]): Converted {
  const ctx: Ctx = { sidecar: {}, seen: new Set(), counter: 0, originals: {} };
  const out = blocks.map((b) => blockToBN(b, ctx));
  return { blocks: out, sidecar: ctx.sidecar, originals: ctx.originals };
}

const isDefault = (v: unknown, fallback: unknown) => v === fallback;

type Override = (b: BNBlock) => LegacyBlock | undefined;

function bnToLegacy(b: BNBlock, sidecar: Sidecar, override?: Override): LegacyBlock {
  const kept = override?.(b);
  if (kept) return kept;
  const side = sidecar[b.id];
  if (side && has(side, 'opaque')) return clone(side.opaque) as LegacyBlock;
  const absent = new Set(side?.absent ?? []);
  const out: LegacyBlock = {};

  const legacyId = side && has(side, 'origId') ? side.origId : b.id;
  if (side && has(side, 'origId') && legacyId === null) { /* the original had no id */ } else out.id = legacyId;

  let type: string;
  if (b.type === 'heading') type = `h${Number(b.props.level) || 1}`;
  else if (b.type === 'columns') type = 'cols';
  else if (b.type === 'table') type = 'table';
  else type = BN_TO_LEGACY[b.type] ?? 'text';
  out.type = type;

  if (b.type === 'columns') {
    const cols = b.children.filter((c) => c.type === 'column');
    if (!(absent.has('cols') && cols.length === 0)) out.cols = cols.map((c) => c.children.map((x) => bnToLegacy(x, sidecar, override)));
    const kids = b.children.find((c) => c.type === 'columnsChildren');
    if (kids) out.children = kids.children.map((x) => bnToLegacy(x, sidecar, override));
    else if (!absent.has('children')) out.children = [];
  } else {
    if (b.type === 'table') {
      const rows = b.content && !Array.isArray(b.content) ? b.content.rows : [];
      if (!(absent.has('rows') && rows.length === 0)) out.rows = rows.map((r) => r.cells.map((c) => inlineToHtml(c)));
    } else {
      const spec = SPECS[type] as Spec | undefined;
      for (const p of spec?.props ?? []) {
        const v = b.props[p.bn];
        if (absent.has(p.legacy) && isDefault(v, p.fallback)) continue;
        out[p.legacy] = v ?? p.fallback;
      }
      if (spec && spec.content !== 'none') {
        const text = spec.content === 'html' ? inlineToHtml(Array.isArray(b.content) ? b.content : []) : plainOf(b.content);
        if (!(absent.has('text') && text === '')) out.text = text;
      }
      if (spec?.dataBag && typeof b.props.data === 'string') Object.assign(out, JSON.parse(b.props.data) as object);
    }
    if (b.children.length > 0 || !absent.has('children')) out.children = b.children.map((x) => bnToLegacy(x, sidecar, override));
  }
  if (side?.extra) Object.assign(out, clone(side.extra));
  return out;
}

/**
 * `override` lets a caller supply the legacy block for a BlockNote block it knows is unchanged,
 * so untouched blocks are written back byte for byte.
 */
export function blockNoteToLegacy(blocks: BNBlock[], sidecar: Sidecar, override?: Override): LegacyBlock[] {
  return blocks.map((b) => bnToLegacy(b, sidecar, override));
}
