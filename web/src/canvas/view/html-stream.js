/* global parent, document, window, Event, DOMParser, requestAnimationFrame, cancelAnimationFrame */
/** Incremental inert preview: authored scripts execute only in the settled answer. */
export function installHtmlStreaming() {
  let pending = '', frame = 0, stopped = false;
  function reconcile(target, source) {
    const wanted = [...source.childNodes];
    for (let i = 0; i < wanted.length; i++) {
      const incoming = wanted[i], current = target.childNodes[i];
      if (!current || current.nodeType !== incoming.nodeType || current.nodeName !== incoming.nodeName) {
        const copy = incoming.cloneNode(true);
        if (current) target.replaceChild(copy, current); else target.append(copy);
      } else if (incoming.nodeType === 3 || incoming.nodeType === 8) {
        if (current.data !== incoming.data) current.data = incoming.data;
      } else if (incoming.nodeType === 1) {
        for (const attr of [...current.attributes]) if (!incoming.hasAttribute(attr.name)) current.removeAttribute(attr.name);
        for (const attr of incoming.attributes) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
        reconcile(current, incoming);
      }
    }
    while (target.childNodes.length > wanted.length) target.lastChild.remove();
  }
  function apply() {
    frame = 0;
    if (stopped || window.getSelection()?.toString()) return;
    const html = pending.replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '');
    const endings = [...html.matchAll(/<\/(?:p|div|section|article|main|table|ul|ol|blockquote|h[1-6]|pre|body|html)>/gi)];
    const last = endings.at(-1);
    if (!last) return;
    const parsed = new DOMParser().parseFromString(html.slice(0, last.index + last[0].length), 'text/html');
    parsed.querySelectorAll('script,iframe,object,embed,link,meta,base').forEach(el => el.remove());
    parsed.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name) || /^(?:href|src|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
      }
    });
    window.dispatchEvent(new Event('nl-pagination-reset'));
    reconcile(document.head, parsed.head);
    reconcile(document.body, parsed.body);
    window.dispatchEvent(new Event('nl-stream-update'));
  }
  function schedule() { if (!frame && !stopped) frame = requestAnimationFrame(apply); }
  window.addEventListener('message', e => {
    if (e.source === parent && e.data?.__nlHtmlCommand === 'stream' && typeof e.data.html === 'string') { pending = e.data.html; schedule(); }
  });
  document.addEventListener('selectionchange', () => { if (!window.getSelection()?.toString()) schedule(); });
  window.addEventListener('pagehide', () => { stopped = true; cancelAnimationFrame(frame); });
}
export const streamingScript = `<script>(${installHtmlStreaming.toString()})();</` + 'script>';
