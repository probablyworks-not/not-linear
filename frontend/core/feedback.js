// Feedback collector — a persistent floating panel for logging bugs and feature
// ideas from anywhere in the app. Entries append to feedback/FEEDBACK.md via the
// local server; screenshots and screen recordings are captured OS-side with
// `screencapture` (works in both the native shell and a browser tab) and land in
// feedback/media/. Toggle with ⌘⇧B (or ⌘Q in the native shell — browsers reserve it).

import { toast, wireTabInsertsTab } from './ui.js';
import { appState } from './state.js';
import { getActiveViewId } from './registry.js';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function initFeedback(){
  const panel = document.createElement('div');
  panel.id = 'feedback-panel';
  panel.innerHTML = `
    <div class="fb-head">
      <span class="fb-title"><i class="ti ti-bug"></i> Feedback</span>
      <button class="fb-close" title="Close (Esc)"><i class="ti ti-x"></i></button>
    </div>
    <div class="fb-type">
      <button class="fb-type-btn active" data-type="bug">Bug</button>
      <button class="fb-type-btn" data-type="idea">Idea</button>
    </div>
    <textarea class="fb-text" rows="4" placeholder="What happened?"></textarea>
    <div class="fb-media-row">
      <button class="fb-media-btn" id="fb-shot"><i class="ti ti-camera"></i> Screenshot</button>
      <button class="fb-media-btn" id="fb-rec"><i class="ti ti-video"></i> Record</button>
    </div>
    <div class="fb-chips"></div>
    <div class="fb-foot">
      <span class="fb-ctx"></span>
      <button class="fb-save" id="fb-save">Save</button>
    </div>`;
  document.body.appendChild(panel);

  const textEl = panel.querySelector('.fb-text');
  const chipsEl = panel.querySelector('.fb-chips');
  const ctxEl = panel.querySelector('.fb-ctx');
  const mediaRow = panel.querySelector('.fb-media-row');
  const shotBtn = panel.querySelector('#fb-shot');
  const recBtn = panel.querySelector('#fb-rec');
  const saveBtn = panel.querySelector('#fb-save');
  wireTabInsertsTab(textEl);

  let type = 'bug';
  let media = [];          // repo-relative paths returned by the server
  let recording = false;
  let recStart = 0;
  let recTimer = 0;

  // ---------- open / close ----------
  const isOpen = () => panel.classList.contains('show');
  function open(){
    ctxEl.textContent = `${getActiveViewId() || 'chat'} · ${appState.currentThreadId || ''}`;
    panel.classList.add('show');
    textEl.focus();
  }
  function close(){
    if (recording) { toast('Recording still running — stop it first'); return; }
    panel.classList.remove('show');
  }
  const toggle = () => isOpen() ? close() : open();

  document.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    // ⌘⇧B everywhere; ⌘Q works in the native shell (browsers reserve it for quit).
    if ((e.metaKey || e.ctrlKey) && ((e.shiftKey && key === 'b') || (!e.shiftKey && key === 'q'))){
      e.preventDefault();
      toggle();
    }
  });
  // Close on Escape only when focus is inside the panel, and stop the app-level
  // Escape handler from also firing (capture phase runs before it).
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen() && panel.contains(document.activeElement)
        && !overlay.classList.contains('show')){   // preview overlay's own Escape handler wins
      e.stopPropagation();
      close();
    }
  }, true);
  panel.querySelector('.fb-close').addEventListener('click', close);

  // ---------- bug / idea toggle ----------
  panel.querySelectorAll('.fb-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      type = btn.dataset.type;
      panel.querySelectorAll('.fb-type-btn').forEach(b => b.classList.toggle('active', b === btn));
      mediaRow.style.display = type === 'bug' ? '' : 'none';
      textEl.placeholder = type === 'bug' ? 'What happened?' : "What's the idea?";
    });
  });

  // ---------- media chips ----------
  function renderChips(){
    chipsEl.innerHTML = media.map((p, i) => `
      <span class="fb-chip" title="${esc(p)}">
        <i class="ti ${p.endsWith('.mov') ? 'ti-video' : 'ti-photo'}"></i>
        ${esc(p.split('/').pop())}
        <button class="fb-chip-x" data-i="${i}" title="Remove"><i class="ti ti-x"></i></button>
      </span>`).join('');
    chipsEl.querySelectorAll('.fb-chip-x').forEach(x => x.addEventListener('click', () => {
      media.splice(Number(x.dataset.i), 1);   // drops it from the entry; the file stays on disk
      renderChips();
    }));
  }

  async function post(url, body){
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    return res.json();
  }

  // ---------- capture mode menu (Select area / Full screen) ----------
  let captureMenu = null;
  function closeCaptureMenu(){ captureMenu?.remove(); captureMenu = null; }
  function openCaptureMenu(anchor, onPick){
    closeCaptureMenu();
    captureMenu = document.createElement('div');
    captureMenu.className = 'fb-capture-menu';
    captureMenu.innerHTML = `
      <button data-mode="area"><i class="ti ti-crop"></i> Select area</button>
      <button data-mode="full"><i class="ti ti-device-desktop"></i> Full screen</button>`;
    panel.appendChild(captureMenu);
    const a = anchor.getBoundingClientRect(), p = panel.getBoundingClientRect();
    captureMenu.style.left = (a.left - p.left) + 'px';
    captureMenu.style.bottom = (p.bottom - a.top + 6) + 'px';
    captureMenu.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => { const m = b.dataset.mode; closeCaptureMenu(); onPick(m); }));
    setTimeout(() => document.addEventListener('pointerdown', function away(e){
      if (!captureMenu?.contains(e.target)) closeCaptureMenu();
      document.removeEventListener('pointerdown', away);
    }), 0);
  }

  // ---------- screenshot ----------
  async function doShot(mode){
    shotBtn.disabled = true;
    panel.classList.add('fb-capturing');            // hide the panel so it isn't in the shot
    await new Promise(r => setTimeout(r, 250));
    try {
      const out = await post('/__notlinear_feedback_shot', { mode });
      panel.classList.remove('fb-capturing');
      if (out.ok) openPreview('image', out.path);
      else if (!out.cancelled) toast(out.error || 'Screenshot failed');
    } catch {
      panel.classList.remove('fb-capturing');
      toast('Screenshot failed — is the server running?');
    }
    shotBtn.disabled = false;
  }
  shotBtn.addEventListener('click', () => openCaptureMenu(shotBtn, doShot));

  // ---------- screen recording ----------
  function setRecUI(){
    recBtn.classList.toggle('recording', recording);
    if (!recording){
      clearInterval(recTimer);
      recBtn.innerHTML = '<i class="ti ti-video"></i> Record';
    }
  }
  async function startRec(mode){
    recBtn.disabled = true;
    try {
      const out = await post('/__notlinear_feedback_record', { action: 'start', mode });
      if (out.ok){
        recording = true; recStart = Date.now();
        recTimer = setInterval(() => {
          const s = Math.floor((Date.now() - recStart) / 1000);
          recBtn.innerHTML = `<i class="ti ti-player-stop-filled"></i> Stop · ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
        }, 500);
        recBtn.innerHTML = '<i class="ti ti-player-stop-filled"></i> Stop · 0:00';
        if (mode === 'area') toast('Drag to select the area — recording starts on release');
      } else toast(out.error || 'Could not start recording');
    } catch { toast('Recording failed — is the server running?'); }
    setRecUI();
    recBtn.disabled = false;
  }
  async function stopRec(){
    recBtn.disabled = true;
    try {
      const out = await post('/__notlinear_feedback_record', { action: 'stop' });
      recording = false;
      if (out.ok) openPreview('video', out.path);
      else if (out.cancelled) toast('No recording captured');
      else toast(out.error || 'Recording failed');
    } catch {
      recording = false;
      toast('Recording failed — is the server running?');
    }
    setRecUI();
    recBtn.disabled = false;
  }
  recBtn.addEventListener('click', () => {
    if (recording) stopRec();
    else openCaptureMenu(recBtn, startRec);
  });

  // ---------- capture preview: annotate (pen) → Add / Discard ----------
  // Nothing attaches to the report until "Add" is pressed; Discard (or Escape)
  // deletes the just-captured file from disk.
  const overlay = document.createElement('div');
  overlay.id = 'fb-preview-overlay';
  overlay.innerHTML = `
    <div class="fb-preview">
      <div class="fb-preview-head">
        <span class="fb-preview-title"></span>
        <div class="fb-preview-tools">
          <button class="fb-tool active" id="fb-tool-pen" title="Pen"><i class="ti ti-pencil"></i></button>
          <button class="fb-tool" id="fb-tool-undo" title="Undo"><i class="ti ti-arrow-back-up"></i></button>
          <button class="fb-tool" id="fb-tool-clear" title="Clear annotations"><i class="ti ti-eraser"></i></button>
        </div>
      </div>
      <div class="fb-preview-body"></div>
      <div class="fb-preview-foot">
        <button class="fb-preview-discard"><i class="ti ti-trash"></i> Discard</button>
        <button class="fb-preview-add"><i class="ti ti-plus"></i> Add to report</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const pvBody = overlay.querySelector('.fb-preview-body');
  const pvTitle = overlay.querySelector('.fb-preview-title');
  const pvTools = overlay.querySelector('.fb-preview-tools');
  const penBtn = overlay.querySelector('#fb-tool-pen');
  let pv = null;   // { kind, path, canvas, ctx, img, strokes, drawing }

  function closePreview(){ overlay.classList.remove('show'); pvBody.innerHTML = ''; pv = null; }

  function redraw(){
    const { ctx, canvas, img, strokes } = pv;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    ctx.strokeStyle = '#E5534B';
    ctx.lineWidth = Math.max(3, canvas.width / 500);
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const s of strokes){
      ctx.beginPath();
      s.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
      ctx.stroke();
    }
  }

  function canvasPoint(e){
    const r = pv.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (pv.canvas.width / r.width),
             y: (e.clientY - r.top) * (pv.canvas.height / r.height) };
  }

  function openPreview(kind, path){
    pv = { kind, path, strokes: [], drawing: false };
    pvTitle.textContent = kind === 'image' ? 'Screenshot — draw to annotate' : 'Recording preview';
    pvTools.style.display = kind === 'image' ? '' : 'none';
    penBtn.classList.add('active');
    pvBody.innerHTML = '';
    if (kind === 'image'){
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.className = 'fb-preview-canvas';
        pvBody.appendChild(canvas);
        Object.assign(pv, { canvas, ctx: canvas.getContext('2d'), img });
        redraw();
        canvas.addEventListener('pointerdown', e => {
          if (!penBtn.classList.contains('active')) return;
          pv.drawing = true; pv.strokes.push([canvasPoint(e)]);
          canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', e => {
          if (!pv?.drawing) return;
          pv.strokes[pv.strokes.length - 1].push(canvasPoint(e));
          redraw();
        });
        canvas.addEventListener('pointerup', () => { if (pv) pv.drawing = false; });
      };
      img.onerror = () => { pvBody.innerHTML = '<div class="fb-preview-err">Could not load the screenshot.</div>'; };
      img.src = '/' + path + '?t=' + Date.now();
    } else {
      const video = document.createElement('video');
      video.controls = true; video.muted = true; video.autoplay = true;
      video.className = 'fb-preview-video';
      video.src = '/' + path + '?t=' + Date.now();
      video.onerror = () => { pvBody.innerHTML = '<div class="fb-preview-err">Preview not supported in this browser — the recording is still saved and can be added.</div>'; };
      pvBody.appendChild(video);
    }
    overlay.classList.add('show');
  }

  penBtn.addEventListener('click', () => penBtn.classList.toggle('active'));
  overlay.querySelector('#fb-tool-undo').addEventListener('click', () => {
    if (pv?.strokes.length){ pv.strokes.pop(); redraw(); }
  });
  overlay.querySelector('#fb-tool-clear').addEventListener('click', () => {
    if (pv){ pv.strokes = []; redraw(); }
  });

  overlay.querySelector('.fb-preview-add').addEventListener('click', async () => {
    if (!pv) return;
    const { kind, path, canvas, strokes } = pv;
    try {
      if (kind === 'image' && strokes.length && canvas){
        const b64 = canvas.toDataURL('image/png').split(',')[1];
        const out = await post('/__notlinear_feedback_upload', { path, base64: b64 });
        if (!out.ok){ toast(out.error || 'Could not save annotations'); return; }
      }
      media.push(path); renderChips();
      closePreview();
    } catch { toast('Could not save — is the server running?'); }
  });
  overlay.querySelector('.fb-preview-discard').addEventListener('click', async () => {
    if (!pv) return;
    const { path } = pv;
    closePreview();
    try { await post('/__notlinear_feedback_discard', { path }); } catch {}
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('show')){
      e.stopPropagation();
      overlay.querySelector('.fb-preview-discard').click();
    }
  }, true);

  // ---------- save ----------
  saveBtn.addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text && !media.length){ toast('Nothing to save yet'); return; }
    if (recording){ toast('Stop the recording first'); return; }
    saveBtn.disabled = true;
    try {
      const out = await post('/__notlinear_feedback_save', {
        type, text, media,
        context: { view: getActiveViewId() || 'chat', thread: appState.currentThreadId || '' },
      });
      if (out.ok){
        toast(`Saved ${out.id} → ${out.path}`);
        textEl.value = ''; media = []; renderChips();
        logLoaded = false;   // settings list refetches next time it's opened
      } else toast(out.error || 'Save failed');
    } catch { toast('Save failed — is the server running?'); }
    saveBtn.disabled = false;
  });

  // ---------- settings: bugs & ideas log ----------
  // Mirrors the Changelog section pattern: collapsed by default, loads on first
  // expand, refresh button re-fetches. Entries come from feedback/FEEDBACK.md
  // parsed server-side (newest first).
  const logToggle = document.querySelector('#fb-log-toggle');
  const logView = document.querySelector('#fb-log-view');
  const logCount = document.querySelector('#fb-log-count');
  const logList = document.querySelector('#fb-log-list');
  let logLoaded = false;

  async function loadFeedbackLog(force = false){
    if (logLoaded && !force) return;
    logCount.textContent = 'Loading…';
    try {
      const out = await post('/__notlinear_feedback_list');
      if (!out.ok) throw new Error(out.error || 'list failed');
      logLoaded = true;
      const bugs = out.entries.filter(e => e.type === 'bug').length;
      logCount.textContent = out.entries.length
        ? `${bugs} bug${bugs === 1 ? '' : 's'} · ${out.entries.length - bugs} idea${out.entries.length - bugs === 1 ? '' : 's'}`
        : 'Empty';
      logList.innerHTML = out.entries.length ? out.entries.map(en => `
        <div class="fb-log-item">
          <div class="fb-log-head">
            <span class="fb-log-badge ${en.type}">${en.type === 'bug' ? 'Bug' : 'Idea'}</span>
            <span class="fb-log-id">${esc(en.id)}</span>
            <span class="fb-log-date">${esc(en.date)}</span>
            <span class="fb-log-status ${esc(en.status)}">${esc(en.status)}</span>
          </div>
          <div class="fb-log-text">${esc(en.text)}</div>
          ${en.media.length || en.view ? `<div class="fb-log-meta">
            ${en.view ? `<span>${esc(en.view)}${en.thread ? ' · ' + esc(en.thread) : ''}</span>` : ''}
            ${en.media.map(m => `<a href="/${esc(m)}" target="_blank" rel="noopener"><i class="ti ${m.endsWith('.mov') ? 'ti-video' : 'ti-photo'}"></i>${esc(m.split('/').pop())}</a>`).join('')}
          </div>` : ''}
        </div>`).join('')
        : '<div class="fb-log-empty">No feedback yet — press ⌘⇧B anywhere to log a bug or idea.</div>';
    } catch {
      logCount.textContent = 'Unavailable';
      logList.innerHTML = '<div class="fb-log-empty">Could not load — is the server running with the latest code?</div>';
    }
  }

  if (logToggle){
    logToggle.addEventListener('click', () => {
      const expand = logView.hidden;
      logView.hidden = !expand;
      logToggle.setAttribute('aria-expanded', String(expand));
      if (expand) loadFeedbackLog();
    });
    document.querySelector('#fb-log-refresh')?.addEventListener('click', () => loadFeedbackLog(true));
  }

  // ---------- drag by header ----------
  const head = panel.querySelector('.fb-head');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('.fb-close')) return;
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    const move = (ev) => {
      panel.style.left = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - dx)) + 'px';
      panel.style.top = Math.max(0, Math.min(window.innerHeight - rect.height, ev.clientY - dy)) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
