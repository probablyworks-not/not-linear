/* global parent, MutationObserver, document, innerWidth, NodeFilter, getComputedStyle, window, Event, requestAnimationFrame, cancelAnimationFrame */
/** Runs inside the opaque iframe. Self contained so it can be serialized into srcdoc. */
export function installHtmlPagination() {
  const PAGE = 640, GAP = 24, LIMIT = 100000;
  let scheduled = 0, lastWidth = 0, disposed = false;
  let decoration = [], originalStyles = new Map();
  let lastReport = '', burstAt = 0, layoutChanges = 0, unstable = false;
  const send = value => parent.postMessage({ __nlHtmlPart: true, type: 'pagination', ...value }, '*');
  const observer = new MutationObserver(schedule);
  const observe = () => observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'src'] });
  // A reading page has a logical viewport independent of the full canvas document height.
  function viewportUnits(css) {
    return css.replace(/(-?(?:\d*\.)?\d+)(dvh|svh|lvh|vh|vmin|vmax)\b/gi, (_, n, unit) => {
      const base = /min/i.test(unit) ? Math.min(innerWidth, PAGE) : /max/i.test(unit) ? Math.max(innerWidth, PAGE) : PAGE;
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
    // External rules, including accessible @media rules, are normalized too. Opaque stylesheets
    // cannot be inspected; these use the bounded scrolling fallback instead.
    for (const sheet of document.styleSheets) {
      try {
        const visit = rules => {
          for (const rule of rules) {
            if (rule.style) rule.style.cssText = viewportUnits(rule.style.cssText);
            if (rule.cssRules) visit(rule.cssRules);
          }
        };
        visit(sheet.cssRules);
      } catch { throw new Error('External stylesheet requires the original scrolling layout'); }
    }
  }
  function restore() {
    for (const el of decoration) el.remove();
    decoration = [];
    for (const [el, properties] of originalStyles) {
      for (const [name, original] of properties) {
        if (original.value) el.style.setProperty(name, original.value, original.priority);
        else el.style.removeProperty(name);
      }
    }
    originalStyles.clear();
    document.body.normalize();
  }
  function saveStyle(el, name) {
    if (!originalStyles.has(el)) originalStyles.set(el, new Map());
    const properties = originalStyles.get(el);
    if (!properties.has(name)) properties.set(name, { value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) });
  }
  function lines(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const found = new Map();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim() || node.parentElement.closest('script,style,template,[data-nl-page-gap]')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (!rect.height || !rect.width) continue;
        const key = Math.round(rect.top * 2) / 2;
        if (found.has(key)) continue;
        // Find the first character on this line without measuring every character.
        let lo = 0, hi = node.length - 1;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          range.setStart(node, mid); range.setEnd(node, mid + 1);
          const box = range.getBoundingClientRect();
          if (box.top < rect.top - 1) lo = mid + 1; else hi = mid;
        }
        found.set(key, { top: rect.top, bottom: rect.bottom, node, offset: lo, el });
      }
    }
    return [...found.values()].sort((a, b) => a.top - b.top);
  }
  function units(root) {
    const result = [];
    function visit(el) {
      if (el.matches('script,style,template,link,meta,head,[data-nl-page-gap]')) return;
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      if (style.display === 'none') return;
      if (style.position === 'fixed' || style.position === 'absolute' || style.position === 'sticky') {
        throw new Error('Positioned content requires the original scrolling layout');
      }
      if (/^(TABLE)$/.test(el.tagName)) {
        if (el.querySelector('[rowspan]:not([rowspan="1"])')) {
          result.push({ top: box.top, bottom: box.bottom, el }); return;
        }
        for (const row of el.rows) {
          const r = row.getBoundingClientRect(); result.push({ top: r.top, bottom: r.bottom, el: row, row: true });
        }
        return;
      }
      if ((/grid|flex/.test(style.display) && !(style.display.includes('flex') && style.flexDirection === 'column' && style.flexWrap === 'nowrap')) || el.matches('svg,canvas,img,video,iframe,pre') || /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        result.push({ top: box.top, bottom: box.bottom, el }); return;
      }
      if (el.matches('p,li,h1,h2,h3,h4,h5,h6,blockquote') && !el.querySelector('p,li,table,canvas,svg,img,pre,blockquote')) {
        const textLines = lines(el);
        if (textLines.length) result.push(...textLines);
        else result.push({ top: box.top, bottom: box.bottom, el });
        return;
      }
      if (!el.children.length) {
        const textLines = lines(el);
        if (textLines.length) result.push(...textLines); else result.push({ top: box.top, bottom: box.bottom, el });
        return;
      }
      // Anonymous text surrounding block children needs line opportunities too.
      for (const node of [...el.childNodes]) {
        if (node.nodeType === 1) visit(node);
        else if (node.nodeType === 3 && node.data.trim()) {
          const range = document.createRange(); range.selectNodeContents(node);
          const box = range.getBoundingClientRect();
          result.push({ top: box.top, bottom: box.bottom, node, offset: 0, el });
        }
      }
    }
    visit(root);
    return result.sort((a, b) => a.top - b.top);
  }
  function addGap(unit, height) {
    if (unit.row) {
      for (const cell of unit.el.cells) {
        saveStyle(cell, 'padding-top');
        const padding = parseFloat(getComputedStyle(cell).paddingTop) || 0;
        cell.style.setProperty('padding-top', `${padding + height}px`, 'important');
      }
      return;
    }
    if (unit.node) {
      const gap = document.createElement('span');
      gap.dataset.nlPageGap = ''; gap.setAttribute('aria-hidden', 'true');
      gap.style.cssText = `display:block!important;height:${height}px!important;min-height:${height}px!important;margin:0!important;padding:0!important;border:0!important;font-size:0!important;line-height:0!important;pointer-events:none!important;`;
      const range = document.createRange(); range.setStart(unit.node, unit.offset); range.collapse(true); range.insertNode(gap);
      decoration.push(gap);
    } else {
      saveStyle(unit.el, 'margin-top');
      const margin = parseFloat(getComputedStyle(unit.el).marginTop) || 0;
      unit.el.style.setProperty('margin-top', `${margin + height}px`, 'important');
    }
  }
  function layout() {
    scheduled = 0;
    if (disposed) return;
    if (window.getSelection()?.toString()) return;
    observer.disconnect(); restore();
    try {
      if (unstable) throw new Error('Responsive document uses the original scrolling layout');
      normalizeViewport();
      document.documentElement.style.setProperty('height', 'auto', 'important');
      document.body.style.setProperty('min-height', '0', 'important');
      document.body.style.setProperty('height', 'auto', 'important');
      const content = units(document.body), breaks = [];
      let start = 0, added = 0;
      // Plan before writing. Insert text gaps in reverse DOM order so saved text offsets stay valid.
      for (const [index, unit] of content.entries()) {
        let top = unit.top + added, bottom = unit.bottom + added;
        let groupBottom = bottom;
        if (/^H[1-6]$/.test(unit.el.tagName)) {
          const next = content.slice(index + 1).find(u => u.el !== unit.el);
          if (next && next.bottom - unit.top <= PAGE) groupBottom = next.bottom + added;
        }
        if (groupBottom - start > PAGE && top > start + 1) {
          breaks.push({ unit, top, height: GAP });
          added += GAP; top += GAP; bottom += GAP; start = top;
        }
        if (bottom - start > PAGE) {
          // An indivisible chart/layout gets an explicitly tall section rather than clipped content.
          start = bottom;
        }
        if (added + unit.bottom > LIMIT || breaks.length > 200) throw new Error('Large document uses the original scrolling layout');
      }
      for (const br of [...breaks].reverse()) addGap(br.unit, br.height);
      const pages = []; let previous = 0;
      // Use actual spacer geometry, not an assumption about inline formatting or margin collapse.
      for (const br of breaks) {
        let y;
        if (br.unit.row) y = br.unit.el.getBoundingClientRect().top;
        else if (br.unit.node) {
          // Gaps were inserted in reverse order: their array is reverse reading order.
          const index = breaks.filter(b => !!b.unit.node && !b.unit.row).indexOf(br);
          y = [...decoration].reverse()[index].getBoundingClientRect().top;
        } else y = br.unit.el.getBoundingClientRect().top - GAP;
        if (y > previous + 1) {
          const tall = content.some(u => !u.node && u.bottom - u.top > PAGE && u.top + added >= previous);
          pages.push({ top: previous, height: Math.ceil(tall ? y - previous : Math.min(PAGE, y - previous)) });
        }
        previous = y + GAP;
      }
      const body = document.body.getBoundingClientRect();
      const descendants = [...document.body.querySelectorAll('*')].filter(el => !el.matches('script,style,template'));
      const bottom = Math.ceil(Math.max(body.bottom, ...descendants.map(el => el.getBoundingClientRect().bottom)) + (parseFloat(getComputedStyle(document.body).marginBottom) || 0));
      if (!Number.isFinite(bottom) || bottom > LIMIT) throw new Error('Large document uses the original scrolling layout');
      pages.push({ top: previous, height: Math.max(24, bottom - previous) });
      const report = { height: Math.max(24, bottom, previous + 24), pages, oversized: pages.some(p => p.height > PAGE) };
      const signature = JSON.stringify(report);
      if (signature !== lastReport) {
        const now = Date.now();
        if (now - burstAt > 1000) { burstAt = now; layoutChanges = 0; }
        if (++layoutChanges > 6) { unstable = true; throw new Error('Responsive document uses the original scrolling layout'); }
        lastReport = signature; send(report);
      }
      window.dispatchEvent(new Event('nl-pagination-layout'));
    } catch (error) {
      restore();
      const report = { height: PAGE, pages: [], fallback: String(error.message || error) };
      const signature = JSON.stringify(report);
      if (signature !== lastReport) { lastReport = signature; send(report); }
    } finally { observe(); }
  }
  function schedule() { if (!scheduled && !disposed) scheduled = requestAnimationFrame(layout); }
  window.addEventListener('nl-pagination-reset', () => { observer.disconnect(); restore(); observe(); });
  window.addEventListener('nl-stream-update', () => { layoutChanges = 0; burstAt = 0; schedule(); });
  window.addEventListener('resize', () => { if (innerWidth !== lastWidth) { lastWidth = innerWidth; unstable = false; layoutChanges = 0; schedule(); } });
  document.addEventListener('selectionchange', () => { if (!window.getSelection()?.toString()) schedule(); });
  document.addEventListener('load', schedule, true);
  document.fonts?.ready.then(schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  window.addEventListener('pagehide', () => { disposed = true; observer.disconnect(); cancelAnimationFrame(scheduled); });
  lastWidth = innerWidth; schedule();
}

export const paginationScript = `<script>(${installHtmlPagination.toString()})();</` + 'script>';
