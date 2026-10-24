// Pasting a URL into a note. The link appears at once named after the site, then
// renames itself to the article's own title when the preview comes back — so a
// paste never blocks on the network, and never leaves a wall of address text.

import { fetchLinkTitle } from '../lib/link-title';
import { linkDisplayText, linkLabel } from '../lib/link-text';

type StyledText = { type: 'text'; text: string; styles: Record<string, unknown> };
type LinkNode = { type: 'link'; href: string; content: StyledText[] };
interface BlockLike { id: string; content?: unknown; children?: BlockLike[] }

/** The slice of BlockNote's editor this module needs, so it isn't tied to the schema generics. */
export interface LinkEditor {
  document: BlockLike[];
  updateBlock: (id: string, update: { content: unknown }) => void;
}

function isLinkNode(node: unknown): node is LinkNode {
  const n = node as LinkNode | null;
  return !!n && n.type === 'link' && typeof n.href === 'string' && Array.isArray(n.content);
}

function textOf(node: LinkNode): string {
  return node.content.map(t => (typeof t.text === 'string' ? t.text : '')).join('');
}

function* everyBlock(blocks: BlockLike[]): Generator<BlockLike> {
  for (const b of blocks) {
    yield b;
    if (Array.isArray(b.children)) yield* everyBlock(b.children);
  }
}

/**
 * Rename the just-pasted link to the page's title. Only a link still reading
 * `placeholder` is touched, so a title arriving late never overwrites text the
 * user has since edited.
 */
export async function nameLinkAfterItsPage(editor: LinkEditor, url: string, placeholder: string): Promise<void> {
  const title = await fetchLinkTitle(url);
  if (!title) return;
  for (const block of everyBlock(editor.document)) {
    if (!Array.isArray(block.content)) continue;
    let changed = false;
    const content = (block.content as unknown[]).map(node => {
      if (!isLinkNode(node) || node.href !== url || textOf(node) !== placeholder) return node;
      changed = true;
      const [first] = node.content;
      return { ...node, content: [{ type: 'text', text: title, styles: first?.styles ?? {} }] };
    });
    if (changed) editor.updateBlock(block.id, { content });
  }
}

/**
 * Give any link still showing a bare site name the better name we can work out
 * now — for links pasted before this existed. Called while the note is being
 * edited (and so already dirty), never on open: opening a note must write nothing.
 */
export function upgradeLinkNames(editor: LinkEditor): void {
  for (const block of everyBlock(editor.document)) {
    if (!Array.isArray(block.content)) continue;
    let changed = false;
    const content = (block.content as unknown[]).map(node => {
      if (!isLinkNode(node)) return node;
      const text = textOf(node);
      if (text !== linkLabel(node.href)) return node;
      const better = linkDisplayText(node.href);
      if (better === text) return node;
      changed = true;
      const [first] = node.content;
      void nameLinkAfterItsPage(editor, node.href, better);
      return { ...node, content: [{ type: 'text', text: better, styles: first?.styles ?? {} }] };
    });
    if (changed) editor.updateBlock(block.id, { content });
  }
}

/** Handle a pasted bare URL: link the selection if there is one, otherwise insert a named link. */
export function pasteUrlAsLink(editor: LinkEditor & { getSelectedText: () => string; createLink: (url: string, text?: string) => void }, url: string): void {
  if (editor.getSelectedText()) { editor.createLink(url); return; }
  const label = linkDisplayText(url);
  editor.createLink(url, label);
  void nameLinkAfterItsPage(editor, url, label);
}
