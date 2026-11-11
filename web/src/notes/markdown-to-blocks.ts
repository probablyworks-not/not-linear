import { inlineMd } from '../lib/markdown';
import { uid } from './notes-ops';
import type { LegacyBlock } from './types';

// Markdown, as a model writes it, to the legacy Notes block model (the inverse of
// export-markdown.ts's blocksToMarkdown). Line based and forgiving, like lib/markdown.ts: it covers
// what a long reply actually contains (headings, lists with nesting, to-dos, quotes, fenced code,
// tables, rules, display equations) and turns anything else into a text block rather than dropping it.
// Inline spans reuse the chat renderer's inlineMd, so a note reads the same as the reply it came from.

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TODO = /^\[([ xX])\]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const block = (type: string, extra: Record<string, unknown> = {}): LegacyBlock => ({ id: uid(), type, ...extra });

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

const isTableStart = (lines: string[], i: number): boolean =>
  lines[i]!.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!) && lines[i + 1]!.includes('-');

/** Indent width, with a tab counting as four columns. */
const indentOf = (ws: string): number => ws.replace(/\t/g, '    ').length;

export function markdownToBlocks(markdown: string): LegacyBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: LegacyBlock[] = [];
  // Open list items by indent, so a deeper item becomes a child of the nearest shallower one.
  let stack: Array<{ indent: number; block: LegacyBlock }> = [];
  let i = 0;

  const flush = (target: LegacyBlock[], para: string[]): void => {
    if (!para.length) return;
    target.push(block('text', { text: para.map(inlineMd).join('<br>') }));
    para.length = 0;
  };
  const para: string[] = [];
  const endPara = (): void => flush(out, para);

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      endPara(); stack = [];
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i++; // the closing fence; a reply cut off mid-block simply ends the block
      out.push(block('code', { lang: fence[1] || 'plain', text: code.join('\n') }));
      continue;
    }

    if (!line.trim()) { endPara(); stack = []; i++; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      endPara(); stack = [];
      out.push(block(`h${Math.min(heading[1]!.length, 4)}`, { text: inlineMd(heading[2]!) }));
      i++; continue;
    }

    if (RULE.test(line)) { endPara(); stack = []; out.push(block('divider')); i++; continue; }

    if (isTableStart(lines, i)) {
      endPara(); stack = [];
      const width = splitRow(lines[i]!).length;
      const rows = [splitRow(lines[i]!)];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(splitRow(lines[i++]!));
      out.push(block('table', { rows: rows.map(r => Array.from({ length: width }, (_, c) => inlineMd(r[c] ?? ''))) }));
      continue;
    }

    const eq = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
    if (eq) { endPara(); stack = []; out.push(block('eq', { text: eq[1]!.trim() })); i++; continue; }

    const quote = QUOTE.exec(line);
    if (quote) {
      endPara(); stack = [];
      const parts = [quote[1]!];
      i++;
      while (i < lines.length && QUOTE.test(lines[i]!)) parts.push(QUOTE.exec(lines[i++]!)![1]!);
      out.push(block('quote', { text: parts.filter(p => p.trim()).map(inlineMd).join('<br>') }));
      continue;
    }

    const list = LIST.exec(line);
    if (list) {
      endPara();
      const indent = indentOf(list[1]!);
      const numbered = /^\d/.test(list[2]!);
      const todo = !numbered ? TODO.exec(list[3]!) : null;
      const item = todo
        ? block('todo', { text: inlineMd(todo[2]!), done: todo[1] !== ' ' })
        : block(numbered ? 'numbered' : 'bullet', { text: inlineMd(list[3]!) });
      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const parent = stack[stack.length - 1]?.block;
      if (parent) {
        const kids = (parent.children as LegacyBlock[] | undefined) ?? [];
        kids.push(item);
        parent.children = kids;
      } else {
        out.push(item);
      }
      stack.push({ indent, block: item });
      i++; continue;
    }

    // An indented continuation line belongs to the list item above it.
    if (stack.length && /^\s+\S/.test(line)) {
      const last = stack[stack.length - 1]!.block;
      last.text = `${String(last.text ?? '')}<br>${inlineMd(line.trim())}`;
      i++; continue;
    }

    stack = [];
    para.push(line.trim());
    i++;
  }
  endPara();
  return out.length ? out : [block('text', { text: '' })];
}
