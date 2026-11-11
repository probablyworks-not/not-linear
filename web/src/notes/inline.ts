import type { BNInline, BNText, BNWrapped, InlineStyles } from './types';

// Legacy block text is an HTML string built by contenteditable. This maps it to
// structured inline nodes and back. The rule that keeps it lossless: an element
// is mapped only when its tag, attributes and every descendant are exactly what
// the app emits; otherwise the whole top-level piece is kept as `raw` HTML.
// The round trip is exact per character and per annotation, not per byte: nesting
// order, <strong> vs <b> and attribute order are normalised.

const STYLE_TAG: Record<string, keyof InlineStyles> = {
  b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline',
  s: 'strike', strike: 'strike', del: 'strike', code: 'code',
};

function attrNames(el: Element): string[] {
  return Array.from(el.attributes, (a) => a.name).sort();
}
function onlyAttrs(el: Element, names: string[]): boolean {
  const have = attrNames(el);
  const want = [...names].sort();
  return have.length === want.length && have.every((n, i) => n === want[i]);
}
function nonEmpty(v: string | null): v is string {
  return v !== null && v !== '';
}

function serializeNode(node: Node): string {
  const holder = document.createElement('div');
  holder.appendChild(node.cloneNode(true));
  return holder.innerHTML;
}

function sameStyles(a: InlineStyles, b: InlineStyles): boolean {
  const ka = Object.keys(a) as (keyof InlineStyles)[];
  const kb = Object.keys(b) as (keyof InlineStyles)[];
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

function mergeText<T extends BNInline>(nodes: T[]): T[] {
  const out: T[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && n.type === 'text' && sameStyles(prev.styles, n.styles)) {
      out[out.length - 1] = { ...prev, text: prev.text + n.text };
    } else {
      out.push(n);
    }
  }
  return out;
}

type Mode = 'top' | 'wrapped';

/** Returns null when `node` (or anything under it) cannot be mapped exactly. */
function convertNode(node: Node, styles: InlineStyles, mode: Mode): BNInline[] | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return text === '' ? [] : [{ type: 'text', text, styles: { ...styles } }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') return onlyAttrs(el, []) ? [{ type: 'br' }] : null;

  const styleKey = STYLE_TAG[tag];
  let next: InlineStyles | null = null;
  if (styleKey && onlyAttrs(el, [])) {
    next = { ...styles, [styleKey]: true };
  } else if (tag === 'span' && onlyAttrs(el, ['data-color']) && nonEmpty(el.getAttribute('data-color'))) {
    const color = el.getAttribute('data-color') as string;
    if (styles.textColor !== undefined && styles.textColor !== color) return null;
    next = { ...styles, textColor: color };
  } else if (tag === 'mark' && onlyAttrs(el, [])) {
    if (styles.highlight !== undefined && styles.highlight !== 'yellow') return null;
    next = { ...styles, highlight: 'yellow' };
  } else if (tag === 'mark' && onlyAttrs(el, ['data-c'])) {
    const c = el.getAttribute('data-c');
    if (!nonEmpty(c) || c === 'yellow') return null;
    if (styles.highlight !== undefined && styles.highlight !== c) return null;
    next = { ...styles, highlight: c };
  }
  if (next) return convertChildren(el, next, mode);

  if (mode === 'wrapped') return null;

  if (tag === 'a') {
    const href = el.getAttribute('href');
    const names = attrNames(el);
    if (href === null || !names.every((n) => n === 'href' || n === 'target' || n === 'rel')) return null;
    const content = convertChildren(el, styles, 'wrapped') as BNWrapped[] | null;
    if (!content) return null;
    const link: BNInline = { type: 'link', href, content };
    if (el.hasAttribute('target')) link.target = el.getAttribute('target') as string;
    if (el.hasAttribute('rel')) link.rel = el.getAttribute('rel') as string;
    return [link];
  }

  if (tag === 'span') {
    const cls = el.getAttribute('class');
    if (cls === 'nt-br-anchor' && onlyAttrs(el, ['class', 'data-bid']) && nonEmpty(el.getAttribute('data-bid'))) {
      const content = convertChildren(el, styles, 'wrapped') as BNWrapped[] | null;
      return content ? [{ type: 'branchAnchor', bid: el.getAttribute('data-bid') as string, content }] : null;
    }
    if (cls === 'nt-cmt' && onlyAttrs(el, ['class', 'data-cid']) && nonEmpty(el.getAttribute('data-cid'))) {
      const content = convertChildren(el, styles, 'wrapped') as BNWrapped[] | null;
      return content ? [{ type: 'comment', cid: el.getAttribute('data-cid') as string, content }] : null;
    }
    // Atomic spans carry no style slot, so an outer style around one must keep it raw.
    if (Object.keys(styles).length > 0) return null;
    if (
      (cls === 'nt-eq-inline' || cls === 'nt-eq-inline eq-error') &&
      onlyAttrs(el, ['class', 'contenteditable', 'data-tex']) &&
      el.getAttribute('contenteditable') === 'false'
    ) {
      return [{ type: 'inlineEq', tex: el.getAttribute('data-tex') as string, inner: el.innerHTML, error: cls !== 'nt-eq-inline' }];
    }
    if (
      cls === 'nt-mention' &&
      onlyAttrs(el, ['class', 'contenteditable', 'data-kind', 'data-id']) &&
      el.getAttribute('contenteditable') === 'false' &&
      nonEmpty(el.getAttribute('data-kind')) &&
      nonEmpty(el.getAttribute('data-id')) &&
      Array.from(el.childNodes).every((c) => c.nodeType === Node.TEXT_NODE)
    ) {
      return [{ type: 'mention', kind: el.getAttribute('data-kind') as string, id: el.getAttribute('data-id') as string, text: el.textContent ?? '' }];
    }
  }
  return null;
}

function convertChildren(el: Element, styles: InlineStyles, mode: Mode): BNInline[] | null {
  const out: BNInline[] = [];
  for (const child of Array.from(el.childNodes)) {
    const r = convertNode(child, styles, mode);
    if (!r) return null;
    out.push(...r);
  }
  return mergeText(out);
}

export function htmlToInline(html: string): BNInline[] {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const out: BNInline[] = [];
  for (const child of Array.from(tpl.content.childNodes)) {
    const r = convertNode(child, {}, 'top');
    if (r) out.push(...r);
    else out.push({ type: 'raw', html: serializeNode(child) });
  }
  return mergeText(out);
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
}
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
}

function textToHtml(n: BNText): string {
  if (n.text === '') return '';
  const s = n.styles;
  let h = escapeText(n.text);
  if (s.code) h = `<code>${h}</code>`;
  if (s.strike) h = `<strike>${h}</strike>`;
  if (s.underline) h = `<u>${h}</u>`;
  if (s.italic) h = `<i>${h}</i>`;
  if (s.bold) h = `<b>${h}</b>`;
  if (s.highlight !== undefined) {
    h = s.highlight === 'yellow' ? `<mark>${h}</mark>` : `<mark data-c="${escapeAttr(s.highlight)}">${h}</mark>`;
  }
  if (s.textColor !== undefined) h = `<span data-color="${escapeAttr(s.textColor)}">${h}</span>`;
  return h;
}

export function inlineToHtml(nodes: BNInline[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': out += textToHtml(n); break;
      case 'br': out += '<br>'; break;
      case 'raw': out += n.html; break;
      case 'link': {
        const t = n.target !== undefined ? ` target="${escapeAttr(n.target)}"` : '';
        const r = n.rel !== undefined ? ` rel="${escapeAttr(n.rel)}"` : '';
        out += `<a href="${escapeAttr(n.href)}"${t}${r}>${inlineToHtml(n.content)}</a>`;
        break;
      }
      case 'branchAnchor':
        out += `<span class="nt-br-anchor" data-bid="${escapeAttr(n.bid)}">${inlineToHtml(n.content)}</span>`;
        break;
      case 'comment':
        out += `<span class="nt-cmt" data-cid="${escapeAttr(n.cid)}">${inlineToHtml(n.content)}</span>`;
        break;
      case 'inlineEq':
        out += `<span class="nt-eq-inline${n.error ? ' eq-error' : ''}" contenteditable="false" data-tex="${escapeAttr(n.tex)}">${n.inner}</span>`;
        break;
      case 'mention':
        out += `<span class="nt-mention" contenteditable="false" data-kind="${escapeAttr(n.kind)}" data-id="${escapeAttr(n.id)}">${escapeText(n.text)}</span>`;
        break;
    }
  }
  return out;
}
