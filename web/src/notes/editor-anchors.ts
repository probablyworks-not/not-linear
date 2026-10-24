import { BRANCHABLE_TYPES, truncate } from './note-branches';

// Branch anchors inside a live editor: wrap the selected text in a `branchAnchor` node, and take one
// out again. Done with ProseMirror transactions on the document BlockNote already holds, so undo,
// collaboration and the save path see an ordinary edit.

interface PmNode {
  type: { name: string };
  attrs: Record<string, unknown>;
  content: unknown;
  nodeSize: number;
  isText?: boolean;
  marks?: { type: { name: string } }[];
  descendants(cb: (n: PmNode, pos: number) => boolean | void): void;
  forEach(cb: (n: PmNode) => void): void;
}
interface Tr {
  selection: { from: number; to: number; $from: { sameParent(o: unknown): boolean; parent: PmNode; depth: number; node(d: number): PmNode }; $to: unknown };
  doc: PmNode & {
    type: { schema: { nodes: Record<string, { create(attrs: unknown, content: unknown): PmNode } | undefined> } };
    slice(from: number, to: number): { content: PmNode };
    textBetween(from: number, to: number): string;
  };
  replaceRangeWith(from: number, to: number, node: PmNode): Tr;
  replaceWith(from: number, to: number, content: unknown): Tr;
}
export interface TransactEditor { transact<T>(cb: (tr: Tr) => T): T }

export type WrapResult =
  | { ok: true; quote: string; blockId: string }
  | { ok: false; reason: 'empty' | 'unsupported-block' | 'across-blocks' | 'contains-link-or-atom' | 'failed' };

/** What a selection can be branched on, and the anchor over it. Nothing changes unless it returns ok. */
export function wrapSelectionInBranch(editor: TransactEditor, bid: string): WrapResult {
  return editor.transact(tr => {
    const { from, to, $from, $to } = tr.selection;
    if (from === to) return { ok: false, reason: 'empty' } as const;
    if (!$from.sameParent($to)) return { ok: false, reason: 'across-blocks' } as const;
    if (!BRANCHABLE_TYPES.has($from.parent.type.name)) return { ok: false, reason: 'unsupported-block' } as const;
    const nodeType = tr.doc.type.schema.nodes.branchAnchor;
    if (!nodeType) return { ok: false, reason: 'failed' } as const;

    const slice = tr.doc.slice(from, to).content;
    let plain = true;
    slice.forEach(n => {
      // A link is a mark and an equation or mention an atom: neither can sit inside an anchor and still
      // come back out of the converter as an anchor, so they are refused rather than half-kept.
      if (!n.isText || n.marks?.some(m => m.type.name === 'link')) plain = false;
    });
    if (!plain) return { ok: false, reason: 'contains-link-or-atom' } as const;

    try {
      const quote = tr.doc.textBetween(from, to);
      const blockId = String($from.node($from.depth - 1).attrs.id ?? '');
      tr.replaceRangeWith(from, to, nodeType.create({ bid }, slice));
      return { ok: true, quote: truncate(quote, 200), blockId } as const;
    } catch {
      return { ok: false, reason: 'failed' } as const;
    }
  });
}

/** Puts the anchor's text back as plain content. False when no anchor carries `bid`. */
export function unwrapBranch(editor: TransactEditor, bid: string): boolean {
  return editor.transact(tr => {
    let found: { pos: number; node: PmNode } | null = null;
    tr.doc.descendants((node, pos) => {
      if (!found && node.type.name === 'branchAnchor' && node.attrs.bid === bid) found = { pos, node };
      return !found;
    });
    if (!found) return false;
    const hit: { pos: number; node: PmNode } = found;
    tr.replaceWith(hit.pos, hit.pos + hit.node.nodeSize, hit.node.content);
    return true;
  });
}

/** Every branch id with an anchor in the document. */
export function anchorIds(editor: TransactEditor): string[] {
  return editor.transact(tr => {
    const ids: string[] = [];
    tr.doc.descendants(node => { if (node.type.name === 'branchAnchor') ids.push(String(node.attrs.bid)); });
    return ids;
  });
}
