import { renderMarkdown } from '../../lib/markdown';

/** UI-only text is never part of a frozen source. */
const DECORATION = 'button, script, style, .code-block-head, .nl-jumpto, [data-canvas-decoration]';
const BLOCK = /^(P|LI|H[1-6]|BLOCKQUOTE|PRE|TR)$/;
export function textSegments(root: Node): { text: string; runs: { node: Text; start: number; end: number }[] } {
  let text = '';
  const runs: { node: Text; start: number; end: number }[] = [];
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const visit = (node: Node): void => {
    if (node instanceof Element && node.matches(DECORATION)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length; text += node.textContent ?? '';
      runs.push({ node: node as Text, start, end: text.length }); return;
    }
    if (node instanceof Element && node.tagName === 'BR') { newline(); return; }
    node.childNodes.forEach(visit);
    if (node instanceof Element && BLOCK.test(node.tagName)) newline();
  };
  visit(root);
  return { text, runs };
}
export function contentText(root: Node): string { return textSegments(root).text; }

export function quoteOccurrence(root: HTMLElement, range: Range, quote: string): number {
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const prefix = contentText(before.cloneContents());
  let count = 0, at = 0;
  while (quote && (at = prefix.indexOf(quote, at)) >= 0) { count++; at += quote.length; }
  return count;
}

/** Map the renderer's text back to raw source offsets. Anchor offsets stay raw-source offsets,
 * as in existing snapshots; only the frozen content is the human-readable selection. */
interface Projection { visible: string; offsets: number[]; ends: number[] }
let cached: { source: string; html: boolean; root?: HTMLElement; text?: string; value: Projection } | null = null;
function project(source: string, html: boolean, renderedRoot?: HTMLElement): Projection {
  const rendered = renderedRoot ? textSegments(renderedRoot) : undefined;
  if (cached?.source === source && cached.html === html && cached.root === renderedRoot && cached.text === rendered?.text) return cached.value;
  let raw = source;
  let rawOffsets = Array.from({ length: source.length }, (_, i) => i);
  let rawEnds = rawOffsets.map(i => i + 1);
  if (html) {
    raw = ''; rawOffsets = []; rawEnds = [];
    const decoder = document.createElement('textarea');
    const tokens = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<head\b[^>]*>[\s\S]*?<\/head\s*>|<button\b[^>]*>[\s\S]*?<\/button\s*>|<template\b[^>]*>[\s\S]*?<\/template\s*>|<(?:"[^"]*"|'[^']*'|[^'">])*>|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);|[^<&]+|[<&]/gi;
    for (const token of source.matchAll(tokens)) {
      const value = token[0], start = token.index!;
      if (value.startsWith('<') && value.length > 1) {
        if (/^<\/(?:p|li|h[1-6]|blockquote|pre|tr)\b|^<br\b/i.test(value) && raw && !raw.endsWith('\n')) {
          raw += '\n'; rawOffsets.push(start); rawEnds.push(start + value.length);
        }
        continue;
      }
      decoder.innerHTML = value.startsWith('&') ? value : '';
      const text = value.startsWith('&') ? decoder.value : value;
      raw += text;
      for (let i = 0; i < text.length; i++) {
        rawOffsets.push(start + (text === value ? i : 0));
        rawEnds.push(start + (text === value ? i + 1 : value.length));
      }
    }
  }
  let visible: string, offsets: number[], ends: number[];
  if (html) { visible = raw; offsets = rawOffsets; ends = rawEnds; }
  else {
    const root = renderedRoot ?? document.createElement('div');
    if (!renderedRoot) root.innerHTML = renderMarkdown(source);
    const semantic = rendered ?? textSegments(root);
    visible = semantic.text;
    offsets = Array(visible.length).fill(-1) as number[];
    ends = Array(visible.length).fill(-1) as number[];
    let cursor = 0;
    for (const run of semantic.runs) {
      const text = run.node.data;
      let at = raw.indexOf(text, cursor);
      const href = run.node.parentElement?.closest('a')?.getAttribute('href');
      const linkAt = href ? raw.indexOf(href, cursor) : -1;
      const mappedLink = at < 0 && linkAt >= 0;
      if (mappedLink) at = linkAt;
      for (let i = 0; i < text.length; i++) {
        offsets[run.start + i] = at < 0 ? -1 : mappedLink ? at : at + i;
        ends[run.start + i] = at < 0 ? -1 : mappedLink ? at + href!.length : at + i + 1;
      }
      if (at >= 0) cursor = at + (mappedLink ? href!.length : text.length);
    }
  }
  const value = { visible, offsets, ends };
  cached = { source, html, root: renderedRoot, text: rendered?.text, value };
  return value;
}

export function sourceRange(source: string, quote: string, occurrence = 0, html = false, renderedRoot?: HTMLElement): { start: number; end: number } | null {
  if (!quote || occurrence < 0 || !Number.isInteger(occurrence)) return null;
  const { visible, offsets, ends } = project(source, html, renderedRoot);
  let at = -1;
  for (let i = 0; i <= occurrence; i++) {
    at = visible.indexOf(quote, at < 0 ? 0 : at + quote.length);
    if (at < 0) return null;
  }
  const start = offsets[at], end = ends[at + quote.length - 1];
  if (start === undefined || end === undefined || start < 0 || end <= start) return null;
  return { start, end };
}

/** Locate an inert element's opening tag in the original source. Count only real tags, skipping
 * comments and script/style bodies; the iframe reports an ordinal, never an executable selector. */
export function htmlElementRange(source: string, tag: string, index: number): { start: number; end: number } | null {
  if (!/^(img|svg|canvas)$/.test(tag) || !Number.isInteger(index) || index < 0 || index > 10000) return null;
  const tokens = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<template\b[^>]*>[\s\S]*?<\/template\s*>|<(?:(?:"[^"]*")|(?:'[^']*')|[^'">])*>/gi;
  let count = 0;
  for (const token of source.matchAll(tokens)) {
    if (!new RegExp(`^<${tag}(?:\\s|/|>)`, 'i').test(token[0])) continue;
    if (count++ === index) return { start: token.index!, end: token.index! + token[0].length };
  }
  return null;
}
