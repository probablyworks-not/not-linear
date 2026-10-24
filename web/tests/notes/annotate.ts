// An oracle for "the same HTML" that does not use the converter's model: every text
// character paired with the set of ancestor descriptors that apply to it. Nesting
// order, <strong> vs <b> and attribute order do not matter; text, styles, link
// targets, anchor ids, equation sources and mention ids all do.

const ALIAS: Record<string, string> = { strong: 'b', em: 'i', strike: 's', del: 's' };

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs = Array.from(el.attributes, (a) => `${a.name}=${a.value}`).sort().join(',');
  return `${ALIAS[tag] ?? tag}[${attrs}]`;
}

export interface Annotated {
  chars: string[];
  /** Every data-bid / data-cid / data-tex value, in document order. */
  ids: string[];
}

/** `newlineIsBr`: a literal newline and <br> render the same in a pre-wrap editor, and the editor path turns one into the other. */
export function annotate(html: string, opts: { newlineIsBr?: boolean } = {}): Annotated {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const chars: string[] = [];
  const ids: string[] = [];
  const walk = (node: Node, stack: string[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const set = [...new Set(stack)].sort().join('>');
      for (const ch of node.textContent ?? '') chars.push(ch === '\n' && opts.newlineIsBr ? '<br>' : `${ch}|${set}`);
      return;
    }
    if (node.nodeType === Node.COMMENT_NODE) { chars.push(`<!--${node.textContent}-->`); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    for (const k of ['data-bid', 'data-cid', 'data-tex']) if (el.hasAttribute(k)) ids.push(`${k}=${el.getAttribute(k)}`);
    if (el.tagName.toLowerCase() === 'br') { chars.push('<br>'); return; }
    const next = [...stack, describe(el)];
    const styleOnly = /^(b|i|u|s|code|mark)\[|^span\[data-color=[^,]*\]$/.test(describe(el));
    const before = chars.length;
    for (const c of Array.from(el.childNodes)) walk(c, next);
    if (chars.length === before && !styleOnly) chars.push(`<empty ${describe(el)}>`);
  };
  for (const c of Array.from(tpl.content.childNodes)) walk(c, []);
  return { chars, ids };
}
