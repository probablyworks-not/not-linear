/* global document, window, Element, requestAnimationFrame, ResizeObserver, MutationObserver, getComputedStyle, innerWidth, innerHeight */
import { readAnnotations, writeAnnotations, deleteAnnotations } from '../db/annotations-repo';
import { toast } from '../ui/toast';
import { useUiStore } from '../state/ui-store';
const confirmDeleteItem = request => useUiStore.getState().askConfirm(request);

// Overlays are body children: never serialized as chat HTML or sent to a model.
export function initAnnotations({ getThreadId, isChat }){
  const NS = 'http://www.w3.org/2000/svg';
  const selector = 'p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,.bub,.msg.ai';
  const layers = new Map();
  const cache = new Map();
  let held = false, toggled = false, drawing = null, active = null, frame = 0;
  let thread = getThreadId();
  const toolbar = document.createElement('div');
  toolbar.className = 'annotation-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Amber annotations');
  toolbar.innerHTML = '<button type="button" data-action="draw" aria-pressed="false" title="Draw amber annotations (hold H)">Amber marker · H</button><button type="button" data-action="undo">Undo</button><button type="button" data-action="clear">Clear</button><span class="annotation-surface"></span>';
  document.body.append(toolbar);
  const key = (tid, bid) => JSON.stringify([tid, bid]);
  const editable = el => el instanceof Element && !!el.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const enabled = () => isChat() && !document.querySelector('[role="dialog"],[role="alertdialog"]') && (held || toggled);
  const blocks = root => [...root.querySelectorAll(selector)].filter(el => !el.closest('button,.msg-actions,.working'));
  const signature = el => `${el.tagName}:${el.textContent}`;
  function anchorFor(el, root){
    const text = signature(el);
    return { scope:(root.matches('.branch-body') ? 'branch' : 'chat-stream'), text, occurrence:blocks(root).filter(b => signature(b) === text).indexOf(el) };
  }
  function resolve(anchor, root){
    if (anchor.scope !== (root.matches('.branch-body') ? 'branch' : 'chat-stream')) return null;
    return blocks(root).filter(b => signature(b) === anchor.text)[anchor.occurrence];
  }
  function load(tid, bid){
    const k = key(tid, bid);
    if (!cache.has(k)){
      const entry = { strokes:[], ready:false };
      cache.set(k, entry);
      readAnnotations(tid, bid).then(strokes => { if (cache.get(k) === entry){ entry.strokes = strokes; entry.ready = true; schedule(); } })
        .catch(() => { toast('Could not load annotations. Reopen this chat to retry.'); cache.delete(k); });
    }
    return cache.get(k);
  }
  function save(layer){
    writeAnnotations(layer.tid, layer.bid, layer.entry.strokes).catch(() => toast('Annotations could not be saved. Keep this window open and try again.'));
  }
  function finish(commit = true){
    if (!drawing) return;
    const d = drawing; drawing = null;
    if (d.layer.svg.hasPointerCapture(d.pointerId)) d.layer.svg.releasePointerCapture(d.pointerId);
    if (commit && d.stroke.points.length){ d.layer.entry.strokes.push(d.stroke); save(d.layer); }
    schedule();
  }
  function stop(){ finish(); held = false; toggled = false; schedule(); }
  function point(e, d){
    const r = d.block.getBoundingClientRect();
    return [(e.clientX-r.left)/Math.max(1,r.width), (e.clientY-r.top)/Math.max(1,r.height)];
  }
  function addLayer(root, bid){
    const svg = document.createElementNS(NS, 'svg');
    svg.classList.add('annotation-layer');
    svg.setAttribute('aria-hidden', 'true');
    document.body.append(svg);
    const layer = { root, bid, tid:thread, svg, entry:load(thread, bid) };
    layers.set(root, layer);
    svg.addEventListener('pointermove', e => {
      if (!drawing || drawing.layer !== layer || drawing.pointerId !== e.pointerId) return;
      e.preventDefault();
      const samples = e.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [e]) drawing.stroke.points.push(point(sample,drawing));
      schedule();
    });
    svg.addEventListener('pointerup', e => { if (drawing?.pointerId === e.pointerId) finish(); });
    svg.addEventListener('pointercancel', () => finish(false));
    svg.addEventListener('lostpointercapture', () => finish());
    resize.observe(root);
    return layer;
  }
  function render(){
    frame = 0;
    if (thread !== getThreadId()){
      stop(); thread = getThreadId(); active = null;
      layers.forEach(l => { resize.unobserve(l.root); l.svg.remove(); }); layers.clear();
    }
    const visible = isChat() && !document.querySelector('[data-testid="branch-canvas"]');
    if (!visible && (held || toggled || drawing)) stop();
    toolbar.hidden = !visible || !!document.querySelector('[role="dialog"],[role="alertdialog"]');
    // Follow the chat column as the sidebar and branch drawer change its margins.
    // A screen-fixed left offset would cover the sidebar's Recent branches list.
    const column = document.querySelector('[data-chat-stream]')?.getBoundingClientRect();
    if (column) toolbar.style.left = `${Math.max(16, Math.min(innerWidth-toolbar.offsetWidth-16,column.left+16))}px`;
    const roots = visible ? [...document.querySelectorAll('[data-chat-stream] > .chat-stream,.branch-stack .branch-body')] : [];
    layers.forEach((l, root) => { if (!roots.includes(root)){ if (drawing?.layer === l) finish(); resize.unobserve(root); l.svg.remove(); layers.delete(root); if (active === l) active = null; } });
    for (const root of roots){
      const bid = root.closest('.branch')?.dataset.bid || '';
      const l = layers.get(root) || addLayer(root,bid);
      l.svg.style.zIndex = bid ? String(70 + Number(root.closest('.branch').style.zIndex || 0)) : '39';
      const r = root.getBoundingClientRect();
      if (!root.getClientRects().length){ l.svg.style.display = 'none'; continue; }
      l.svg.style.display = '';
      let top = Math.max(0,r.top), left = Math.max(0,r.left), right = Math.min(innerWidth,r.right), bottom = Math.min(innerHeight,r.bottom);
      // Branch bodies clip internally as well as at the window boundary.
      for (let parent = root.parentElement; parent && parent !== document.body; parent = parent.parentElement){
        const css = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY + css.overflowX)){
          const pr = parent.getBoundingClientRect(); top = Math.max(top,pr.top); bottom = Math.min(bottom,pr.bottom); left = Math.max(left,pr.left); right = Math.min(right,pr.right);
        }
      }
      if (!bid){
        const header = document.querySelector('[data-testid="topbar"]')?.getBoundingClientRect();
        if (header) top = Math.max(top,header.bottom);
        const composer = document.querySelector('.composer-wrap')?.getBoundingClientRect();
        if (composer) bottom = Math.min(bottom,composer.top);
      }
      const w = Math.max(0,right-left), h = Math.max(0,bottom-top);
      Object.assign(l.svg.style,{ left:`${left}px`,top:`${top}px`,width:`${w}px`,height:`${h}px` });
      l.svg.classList.toggle('annotation-drawing', enabled());
      l.svg.replaceChildren();
      const strokes = [...l.entry.strokes, ...(drawing?.layer === l ? [drawing.stroke] : [])];
      for (const stroke of strokes){
        const block = resolve(stroke.anchor,root);
        if (!block) continue;
        const b = block.getBoundingClientRect();
        const path = document.createElementNS(NS,'path');
        path.setAttribute('d',stroke.points.map(([x,y],i) => `${i?'L':'M'}${b.left-left+x*b.width},${b.top-top+y*b.height}`).join(' ') + (stroke.points.length === 1 ? ' l0.01,0' : ''));
        l.svg.append(path);
      }
    }
    if (!active) active = layers.get(document.querySelector('[data-chat-stream] > .chat-stream')) || layers.values().next().value;
    toolbar.querySelector('[data-action="draw"]').setAttribute('aria-pressed',String(enabled()));
    toolbar.querySelector('.annotation-surface').textContent = active?.bid ? 'Branch' : 'Chat';
    for (const name of ['undo','clear']) toolbar.querySelector(`[data-action="${name}"]`).disabled = !active?.entry.ready || !active.entry.strokes.length;
  }
  function schedule(){ if (!frame) frame = requestAnimationFrame(render); }
  const resize = new ResizeObserver(schedule);
  const observer = new MutationObserver(schedule);
  for (const el of document.querySelectorAll('#root')) observer.observe(el,{ childList:true,subtree:true,characterData:true,attributes:true });
  // View changes can occur without replacing the conversation DOM.
  const viewObserver = new MutationObserver(schedule);
  viewObserver.observe(document.body,{ attributes:true,attributeFilter:['class'] });

  document.addEventListener('pointerdown', e => {
    if (toolbar.contains(e.target)) return;
    const root = e.target.closest?.('[data-chat-stream] > .chat-stream,.branch-stack .branch-body');
    const layer = layers.get(root);
    if (!layer) return;
    active = layer; schedule();
    if (!enabled() || e.button !== 0 || !layer.entry?.ready) return;
    const block = e.target.closest(selector);
    if (!block || !root.contains(block) || e.target.closest('button,a,input,textarea')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    drawing = { layer, block, pointerId:e.pointerId, stroke:{ anchor:anchorFor(block,root), points:[] } };
    drawing.stroke.points.push(point(e,drawing));
    layer.svg.setPointerCapture(e.pointerId);
    window.getSelection()?.removeAllRanges();
  },true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (held || toggled || drawing)){ e.preventDefault(); e.stopImmediatePropagation(); stop(); }
    if (e.code !== 'KeyH' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || editable(e.target) || !isChat()) return;
    held = true; e.preventDefault(); schedule();
  },true);
  document.addEventListener('keyup', e => { if (e.code === 'KeyH'){ finish(); held = false; schedule(); } },true);
  window.addEventListener('blur',stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  document.addEventListener('scroll',schedule,true);
  window.addEventListener('resize',schedule);
  toolbar.addEventListener('click',async e => {
    const action = e.target.closest('button')?.dataset.action;
    if (action === 'draw'){ finish(); toggled = !toggled; schedule(); return; }
    const target = active;
    if (!target?.entry.ready) return;
    if (action === 'undo'){ target.entry.strokes.pop(); save(target); }
    if (action === 'clear'){
      stop();
      if (await confirmDeleteItem({ heading:'Clear annotations?',name:target.bid ? 'this branch' : 'this chat',before:'Remove all amber marks from',after:'?',actionLabel:'Clear annotations' })){
        // Main chat has two rendering roots sharing one storage record.
        if (cache.get(key(target.tid,target.bid)) !== target.entry) return;
        target.entry.strokes = []; save(target);
      }
    }
    schedule();
  });
  window.addEventListener('notlinear-annotations-deleted', event => {
    const { threadId, branchIds } = event.detail;
    purge(threadId, branchIds ? new Set(branchIds) : undefined);
  });
  function purge(tid, ids){
    if (drawing?.layer.tid === tid && (!ids || ids.has(drawing.layer.bid))) finish(false);
    for (const [k,entry] of cache){ const [t,b] = JSON.parse(k); if (t === tid && (!ids || ids.has(b))){ entry.strokes = []; cache.delete(k); } }
    schedule();
  }
  schedule();
  return {
    refresh: schedule,
    remove(tid, ids){
      purge(tid,ids);
      deleteAnnotations(tid,ids).catch(() => toast('Could not remove saved annotations.'));
      schedule();
    },
  };
}
