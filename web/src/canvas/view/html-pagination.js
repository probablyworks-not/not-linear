/* global parent, MutationObserver, ResizeObserver, document, innerWidth, getComputedStyle, window, Event, requestAnimationFrame, cancelAnimationFrame */
/** Measure one complete HTML document. Keep the existing iframe message protocol. */
export function installHtmlPagination() {
  const VIEWPORT = 640, LIMIT = 100000;
  let scheduled = 0, disposed = false, lastReport = '';
  const send = value => parent.postMessage({ __nlHtmlPart: true, type: 'pagination', ...value }, '*');
  const observer = new MutationObserver(schedule);
  const observe = () => observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'src', 'open'] });
  // A reading page has a logical viewport independent of the full canvas document height.
  function viewportUnits(css) {
    return css.replace(/(-?(?:\d*\.)?\d+)(dvh|svh|lvh|vh|vmin|vmax)\b/gi, (_, n, unit) => {
      const base = /min/i.test(unit) ? Math.min(innerWidth, VIEWPORT) : /max/i.test(unit) ? Math.max(innerWidth, VIEWPORT) : VIEWPORT;
      return `${Number(n) * base / 100}px`;
    });
  }
  function normalizeViewport() {
    document.querySelectorAll('style').forEach(el => {
      const next = viewportUnits(el.textContent);
      if (next !== el.textContent) el.textContent = next;
    });
    document.querySelectorAll('[style]').forEach(el => {
      const next = viewportUnits(el.getAttribute('style'));
      if (next !== el.getAttribute('style')) el.setAttribute('style', next);
    });
    // Normalize accessible rules without rejecting opaque authored stylesheets.
    for (const sheet of document.styleSheets) {
      try {
        const visit = rules => {
          for (const rule of rules) {
            if (rule.style) rule.style.cssText = viewportUnits(rule.style.cssText);
            if (rule.cssRules) visit(rule.cssRules);
          }
        };
        visit(sheet.cssRules);
      } catch { /* Cross-origin rules stay authored; they do not require a clipped reader. */ }
    }
  }
  function contentBottom() {
    const body = document.body;
    let bottom = body.getBoundingClientRect().bottom + window.scrollY + (parseFloat(getComputedStyle(body).marginBottom) || 0);
    function visit(el) {
      if (el.matches('script,style,template,[data-nl-inspector]')) return;
      const style = getComputedStyle(el);
      // Fixed overlays do not occupy document flow or determine the iframe viewport.
      if (style.display === 'none' || style.position === 'fixed') return;
      bottom = Math.max(bottom, el.getBoundingClientRect().bottom + window.scrollY);
      for (const child of el.children) visit(child);
    }
    for (const child of body.children) visit(child);
    return Math.max(24, Math.ceil(bottom));
  }
  function layout() {
    scheduled = 0;
    if (disposed || window.getSelection()?.toString()) return;
    observer.disconnect();
    try {
      normalizeViewport();
      // Only the document roots expand. Authored nested scrollers/widgets remain intact.
      for (const root of [document.documentElement, document.body]) {
        root.style.setProperty('height', 'auto', 'important');
        root.style.setProperty('min-height', '0', 'important');
        root.style.setProperty('max-height', 'none', 'important');
        root.style.setProperty('overflow-y', 'visible', 'important');
      }
      const height = contentBottom();
      if (!Number.isFinite(height) || height > LIMIT) throw new Error('Document exceeds the full-height reader limit');
      document.documentElement.dataset.nlHtmlExpanded = 'true';
      const report = { height, pages: [{ top: 0, height }], oversized: false };
      const signature = JSON.stringify(report);
      if (signature !== lastReport) { lastReport = signature; send(report); }
      window.dispatchEvent(new Event('nl-pagination-layout'));
    } catch (error) {
      delete document.documentElement.dataset.nlHtmlExpanded;
      document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
      const report = { height: VIEWPORT, pages: [], fallback: String(error.message || error) };
      const signature = JSON.stringify(report);
      if (signature !== lastReport) { lastReport = signature; send(report); }
    } finally { observe(); }
  }
  function schedule() { if (!scheduled && !disposed) scheduled = requestAnimationFrame(layout); }
  // Always answer late parent listeners, including WKWebView's frame-load handshake.
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.__nlHtmlCommand === 'paginate') {
      lastReport = ''; schedule();
    }
  });
  window.addEventListener('nl-pagination-reset', schedule);
  window.addEventListener('nl-stream-update', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('selectionchange', () => { if (!window.getSelection()?.toString()) schedule(); });
  document.addEventListener('load', schedule, true);
  document.fonts?.ready.then(schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  sizeObserver?.observe(document.body);
  window.addEventListener('pagehide', () => {
    disposed = true; observer.disconnect(); sizeObserver?.disconnect(); cancelAnimationFrame(scheduled);
  });
  schedule();
}

export const paginationScript = `<script>(${installHtmlPagination.toString()})();</` + 'script>';
