/**
 * A DOM-independent plan: original block identities in reading order, never cloned HTML.
 * Heights include each block's measured spacing. The renderer supplies safe break units
 * (paragraphs, table rows, etc.) and must remeasure when its fixed width changes.
 *
 * @param {ReadonlyArray<Readonly<{id: string, height: number, keepWithNext?: boolean}>>} blocks
 * @param {{height?: number, padding?: number}} options
 * @returns {{ids: string[], height: number, oversized: boolean}[]}
 */
export function planPages(blocks, { height = 640, padding = 24 } = {}) {
  if (!Number.isFinite(height) || !Number.isFinite(padding) || padding < 0 || height <= 2 * padding) {
    throw new RangeError('Page height must be finite and greater than its padding.');
  }
  const seen = new Set();
  for (const block of blocks) {
    if (!block.id || seen.has(block.id)) throw new Error('Block identities must be unique.');
    if (!Number.isFinite(block.height) || block.height < 0) throw new RangeError('Block height must be finite and non-negative.');
    seen.add(block.id);
  }
  const capacity = height - 2 * padding;
  /** @type {{ids: string[], height: number, oversized: boolean}[]} */
  const pages = [];
  /** @type {string[]} */
  let ids = [];
  let used = 0;
  function flush() {
    if (!ids.length) return;
    pages.push({ ids, height, oversized: false });
    ids = []; used = 0;
  }
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.height > capacity) {
      flush();
      pages.push({ ids: [block.id], height: block.height + 2 * padding, oversized: true });
      continue;
    }
    // Keep a chain of headings/captions together if the entire chain fits a page.
    let groupHeight = block.height;
    for (let j = i; blocks[j]?.keepWithNext && j + 1 < blocks.length; j++) {
      groupHeight += blocks[j + 1].height;
      if (groupHeight > capacity) break;
    }
    if (ids.length && used + (groupHeight <= capacity ? groupHeight : block.height) > capacity) flush();
    ids.push(block.id); used += block.height;
  }
  if (ids.length) pages.push({ ids, height: used + 2 * padding, oversized: false });
  if (!pages.length) pages.push({ ids: [], height, oversized: false });
  return pages;
}
