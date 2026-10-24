import { kidsOf } from './notes-ops';
import type { LegacyBlock, LegacyNote } from './types';

// One page, and every subpage under it, as a single Markdown file (ADR-024). Ported from
// frontend/views/notes.js (slugifyHeading, collectSubpageIds, blocksToMarkdown, noteToMarkdown), and
// tested against those functions. Inline formatting stays as the block's stored HTML, which Markdown
// renderers accept. One deliberate difference: legacy tests for an `equation` block, but the block is
// `eq`, so legacy exports equations as bare TeX; here they come out as `$$ ... $$`, which was the intent.

function stripHtml(html: unknown): string {
  const d = document.createElement('div');
  d.innerHTML = typeof html === 'string' ? html : '';
  return d.textContent || '';
}

export function slugifyHeading(s: unknown): string {
  return String(s || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'untitled';
}

/** Subpages reached through a page-link block, as opposed to the sidebar tree. */
export function collectSubpageIds(list: readonly LegacyBlock[] | undefined, out: string[] = []): string[] {
  for (const b of list ?? []) {
    if (b.type === 'page-link' && typeof b.target === 'string' && b.target) out.push(b.target);
    if (Array.isArray(b.children) && b.children.length) collectSubpageIds(b.children as LegacyBlock[], out);
    if (Array.isArray(b.cols)) for (const c of b.cols as LegacyBlock[][]) collectSubpageIds(c, out);
  }
  return out;
}

const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const str = (v: unknown): string => (v ? String(v) : '');

export function blocksToMarkdown(list: readonly LegacyBlock[] | undefined, noteById: (id: string) => LegacyNote | undefined, depth = 0): string {
  const ind = '  '.repeat(depth);
  const out: string[] = [];
  let num = 0;
  for (const b of list ?? []) {
    num = b.type === 'numbered' ? num + 1 : 0;
    const text = txt(b.text);
    if (b.type === 'h1') out.push(`${ind}# ${text}`);
    else if (b.type === 'h2') out.push(`${ind}## ${text}`);
    else if (b.type === 'h3') out.push(`${ind}### ${text}`);
    else if (b.type === 'h4') out.push(`${ind}#### ${text}`);
    else if (b.type === 'bullet') out.push(`${ind}- ${text}`);
    else if (b.type === 'numbered') out.push(`${ind}${num}. ${text}`);
    else if (b.type === 'todo') out.push(`${ind}${b.done ? '- [x] ' : '- [ ] '}${text}`);
    else if (b.type === 'quote') out.push(`${ind}> ${text}`);
    else if (b.type === 'callout') out.push(`${ind}> ${str(b.emoji) || '\u{1F4A1}'} ${text}`);
    else if (b.type === 'toggle') out.push(`${ind}**${stripHtml(b.text) || 'Toggle'}**`);
    else if (b.type === 'divider') out.push(`${ind}---`);
    else if (b.type === 'code') out.push([`${ind}\`\`\`${b.lang && b.lang !== 'plain' ? str(b.lang) : ''}`, text, `${ind}\`\`\``].join('\n'));
    else if (b.type === 'eq' || b.type === 'equation') out.push(`${ind}$$${text}$$`);
    else if (b.type === 'image') { if (b.src) out.push(`${ind}![${stripHtml(b.caption)}](${str(b.src)})`); }
    else if (b.type === 'table') {
      const rows = Array.isArray(b.rows) ? (b.rows as unknown[][]) : [];
      if (rows.length) {
        const cell = (c: unknown) => txt(c).replace(/\|/g, '\\|');
        const lines = [`${ind}| ${rows[0]!.map(cell).join(' | ')} |`, `${ind}| ${rows[0]!.map(() => '---').join(' | ')} |`];
        rows.slice(1).forEach(r => lines.push(`${ind}| ${r.map(cell).join(' | ')} |`));
        out.push(lines.join('\n'));
      }
    } else if (b.type === 'cols') {
      for (const c of Array.isArray(b.cols) ? (b.cols as LegacyBlock[][]) : []) { const t = blocksToMarkdown(c, noteById, depth); if (t) out.push(t); }
    } else if (b.type === 'page-link') {
      const t = typeof b.target === 'string' && b.target ? noteById(b.target) : undefined;
      const title = t ? (txt(t.title) || 'Untitled') : (text || 'Untitled subpage');
      out.push(`${ind}\u{1F4C4} [${title}](#${slugifyHeading(title)})`);
    } else if (b.type === 'media') { if (b.url) out.push(`${ind}[${str(b.kind) || 'media'}](${str(b.url)})`); }
    else if (b.type === 'file') { if (b.src) out.push(`${ind}[${str(b.name) || 'file'}](${str(b.src)})`); }
    else if (b.type === 'bookmark') { if (b.url) out.push(`${ind}[${str(b.title) || str(b.url)}](${str(b.url)})`); }
    else if (b.type === 'embed') { if (b.url) out.push(`${ind}[embed](${str(b.url)})`); }
    else if (b.type === 'toc') { /* derived from the headings; nothing to export */ }
    else out.push(ind + text);
    // Any block can carry indented children, not only toggles.
    if (b.type !== 'cols' && Array.isArray(b.children) && b.children.length) {
      const t = blocksToMarkdown(b.children as LegacyBlock[], noteById, depth + 1);
      if (t) out.push(t);
    }
  }
  return out.join('\n\n');
}

/** The page, then each subpage (tree children and page-link targets) once, as sections of one file. */
export function noteToMarkdown(notes: readonly LegacyNote[], id: string): string {
  const byId = (i: string) => notes.find(n => n.id === i);
  const visited = new Set<string>();
  const sections: string[] = [];
  const emit = (n: LegacyNote | undefined, depth: number): void => {
    if (!n || visited.has(n.id)) return;
    visited.add(n.id);
    sections.push(`${depth === 0 ? '# ' : '## '}${txt(n.title) || 'Untitled'}`);
    const body = blocksToMarkdown(n.blocks, byId, 0);
    if (body) sections.push(body);
    const childIds = new Set([...kidsOf(notes, n.id).map(c => c.id), ...collectSubpageIds(n.blocks)]);
    childIds.forEach(sid => emit(byId(sid), 1));
  };
  emit(byId(id), 0);
  return `${sections.join('\n\n---\n\n')}\n`;
}

export function exportFilename(note: LegacyNote): string {
  return `${(txt(note.title) || 'Untitled').replace(/[\\/:*?"<>|]/g, '').trim()}.md`;
}
