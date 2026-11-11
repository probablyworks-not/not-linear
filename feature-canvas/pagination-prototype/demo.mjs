import { planPages } from './plan-pages.mjs';
const pages = document.querySelector('#pages');
const measure = document.querySelector('#measure');
const status = document.querySelector('#status');
let blocks = [], timer, generating = false, frame = 0, chartInitializations = 0;
function block(tag, text) {
  const el = document.createElement(tag); el.className = 'block'; el.textContent = text;
  el.dataset.sourceBlock = String(blocks.length); blocks.push(el); return el;
}
function fixture(kind) {
  block('h2', 'A single answer, continued on the canvas');
  block('p', 'Select this paragraph and continue selecting into the next section. This prototype moves the original nodes instead of rendering another copy of the answer.');
  if (kind === 'short') return;
  for (let i = 0; i < 18; i++) {
    if (i % 3 === 0) block('h2', `Section ${i / 3 + 1}`);
    block('p', `Passage ${i + 1}. Reading should continue naturally between sections, while each passage retains its source identity. A repeated phrase: smooth reading. Formatting and interactive elements must survive movement between pages.`);
    if (i === 2 && kind === 'table') {
      const wrap = block('div', ''), table = document.createElement('table');
      const header = table.createTHead().insertRow();
      for (const label of ['Item', 'Value']) { const th = document.createElement('th'); th.textContent = label; header.append(th); }
      for (let r = 0; r < 6; r++) { const row = table.insertRow(); row.insertCell().textContent = `Row ${r + 1}`; row.insertCell().textContent = String((r + 1) * 10); }
      wrap.append(table);
    }
    if (i === 4 && kind === 'chart') {
      const wrap = block('div', ''), canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 220;
      wrap.append(canvas); chartInitializations++; let flipped = false;
      const draw = () => {
        const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 700, 220); ctx.fillStyle = getComputedStyle(pages).color;
        for (let n = 0; n < 5; n++) ctx.fillRect(n * 130 + 20, 200 - (flipped ? 5 - n : n + 1) * 30, 90, (flipped ? 5 - n : n + 1) * 30);
      };
      canvas.addEventListener('click', () => { flipped = !flipped; draw(); });
      canvas.setAttribute('aria-label', 'Click to reverse chart bars'); requestAnimationFrame(draw);
    }
  }
}
function layout() {
  frame = 0;
  // A selected passage is left untouched; subsequent input/resize can reflow it.
  if (window.getSelection()?.toString()) {
    if (!generating) pages.querySelector('.pending')?.remove();
    return;
  }
  measure.style.width = `${pages.clientWidth}px`;
  for (const el of blocks) measure.append(el);
  const measured = blocks.map((el, i) => ({ id: String(i), height: el.getBoundingClientRect().height, keepWithNext: /^H[1-6]$/.test(el.tagName) }));
  const plan = planPages(measured, { height: 640, padding: 24 });
  const fragment = document.createDocumentFragment();
  for (const [i, page] of plan.entries()) {
    const section = document.createElement('section'); section.className = 'page'; section.style.minHeight = `${page.height + 2}px`;
    section.setAttribute('aria-label', `Answer section ${i + 1}`);
    if (page.oversized) section.dataset.oversized = 'true';
    for (const id of page.ids) section.append(blocks[Number(id)]);
    fragment.append(section);
  }
  if (generating) {
    const pending = document.createElement('section'); pending.className = 'page pending';
    pending.setAttribute('aria-label', 'Generating next section'); pending.setAttribute('aria-busy', 'true');
    pending.textContent = 'Building your next section…'; fragment.append(pending);
  }
  pages.replaceChildren(fragment);
  status.textContent = `${plan.length} section(s) · ${blocks.length} original blocks · ${generating ? 'Generating' : 'Complete'} · chart initialized ${chartInitializations} time(s)`;
}
function schedule() { if (!frame) frame = requestAnimationFrame(layout); }
document.querySelector('#stop').addEventListener('click', () => { clearInterval(timer); generating = false; schedule(); });
document.querySelectorAll('[data-fixture]').forEach(button => button.addEventListener('click', () => {
  clearInterval(timer); window.getSelection()?.removeAllRanges(); blocks = []; chartInitializations = 0;
  generating = button.dataset.fixture === 'stream';
  if (generating) {
    layout(); let count = 0;
    timer = setInterval(() => {
      block(count % 4 === 0 ? 'h2' : 'p', `Generated passage ${++count}. A new complete block arrives while earlier passages remain readable. The diagonal shimmer is confined to the unfinished section.`);
      if (count >= 24) { generating = false; clearInterval(timer); } schedule();
    }, 650);
  } else fixture(button.dataset.fixture);
  schedule();
}));
let width = 0;
const observer = new ResizeObserver(entries => { const next = entries[0].contentRect.width; if (next !== width) { width = next; schedule(); } });
observer.observe(pages);
document.fonts?.addEventListener('loadingdone', schedule);
document.addEventListener('selectionchange', () => { if (!window.getSelection()?.toString()) schedule(); });
window.addEventListener('pagehide', () => { clearInterval(timer); observer.disconnect(); cancelAnimationFrame(frame); });
fixture('short'); schedule();
