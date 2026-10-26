// Tags each top-level selectable block in a rendered reply (heading, paragraph, list item,
// blockquote, code block, table) with a stable index and a left-margin hover handle, so a block
// can be picked as a unit — the second selection granularity, alongside the free-range text drag
// `useCanvasSelection.ts` already handles. Pure DOM post-process, same shape as `structureReply`
// (`structure-reply.ts`) and run right after it in `PartView.tsx`'s effect, so what gets tagged is
// the reply's real, final block structure (sections, callouts, nested list bodies already folded
// in) rather than raw `renderMarkdown()` output.
//
// Click/drag wiring (plain click replaces the pick, Cmd/Ctrl-click adds, drag-through spans a
// contiguous run) lives in `PartView.tsx` as one delegated listener — this module only makes the
// handles exist and finds the text behind each one.

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, blockquote, pre, table';
export const BLOCK_HANDLE_ATTR = 'data-block-handle';
export const BLOCK_ATTR = 'data-block';

const HANDLE_DOTS =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">' +
  '<circle cx="2" cy="2" r="1.1" fill="currentColor"/><circle cx="2" cy="5" r="1.1" fill="currentColor"/><circle cx="2" cy="8" r="1.1" fill="currentColor"/>' +
  '<circle cx="6" cy="2" r="1.1" fill="currentColor"/><circle cx="6" cy="5" r="1.1" fill="currentColor"/><circle cx="6" cy="8" r="1.1" fill="currentColor"/>' +
  '</svg>';

const HANDLE_CLASS =
  'absolute -left-[18px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm text-text-3 ' +
  'opacity-0 transition-opacity duration-150 hover:text-accent group-hover:opacity-100 focus-visible:opacity-100';

/** Tags every top-level block inside `root` with `data-block="<n>"` and gives it a hover handle.
 * Idempotent: a block that already carries a handle (an unrelated effect re-run with unchanged
 * content) is skipped rather than given a second one. */
export function tagBlocks(root: HTMLElement): void {
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  // A `<li>`'s own `<p>`, or a `<table>`'s `<td>`/`<th>` rendered as nested matches, belong to
  // their containing block, not a block of their own.
  const blocks = all.filter(el => !all.some(other => other !== el && other.contains(el)));

  blocks.forEach((block, i) => {
    if (block.hasAttribute(BLOCK_ATTR)) return;
    block.setAttribute(BLOCK_ATTR, String(i));
    block.classList.add('group', 'relative');

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.setAttribute(BLOCK_HANDLE_ATTR, String(i));
    handle.setAttribute('aria-label', 'Select this block');
    handle.className = HANDLE_CLASS;
    handle.innerHTML = HANDLE_DOTS;
    block.insertBefore(handle, block.firstChild);
  });
}

/** The text a block's handle stands for — what becomes the frozen quote when it's picked. Reads
 * `textContent` of the block minus its own handle button, same "rendered text, not markdown
 * source" basis `useCanvasSelection.ts` already uses for a free-range quote. */
export function blockQuote(root: HTMLElement, index: number): string | null {
  const block = root.querySelector<HTMLElement>(`[${BLOCK_ATTR}="${index}"]`);
  if (!block) return null;
  const clone = block.cloneNode(true) as HTMLElement;
  clone.querySelector(`[${BLOCK_HANDLE_ATTR}]`)?.remove();
  const text = clone.textContent?.trim();
  return text || null;
}

export function blockCount(root: HTMLElement): number {
  return root.querySelectorAll(`[${BLOCK_ATTR}]`).length;
}
