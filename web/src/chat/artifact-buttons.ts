import type { ArtifactType } from '../projects/extras/types';

// What a reply's finished html / svg / mermaid blocks turn into. An html or svg block is a FILE,
// not something to read as source, so it collapses into a card — title, kind, size, and the three
// things you actually want: Preview, Download, Save to artifacts — with the markup behind "Show
// code". Added to the settled DOM, like mermaid and highlight.js, rather than to renderMarkdown's
// output (which is held to the legacy markup).

export const SAVE_BTN_CLASS = 'artifact-save-btn';
export const DOWNLOAD_BTN_CLASS = 'artifact-download-btn';
export const PREVIEW_BTN_CLASS = 'artifact-preview-btn';
export const CODE_TOGGLE_CLASS = 'artifact-code-toggle';
/** A card that has not been auto-saved yet; ChatView claims these once a reply settles. */
export const FILE_CARD_CLASS = 'artifact-file-card';

export interface BlockPayload { type: ArtifactType; title: string; content: string; kind: 'html' | 'svg' | 'mermaid' }

const LABEL: Record<BlockPayload['kind'], string> = { html: 'HTML page', svg: 'SVG image', mermaid: 'Diagram' };

function titleOf(kind: BlockPayload['kind'], code: string, fallback: string): string {
  const m = kind === 'html' ? /<title[^>]*>([^<]+)<\/title>|<h1[^>]*>([^<]+)<\/h1>/i.exec(code) : kind === 'svg' ? /<title[^>]*>([^<]+)<\/title>/i.exec(code) : null;
  const t = (m?.[1] ?? m?.[2] ?? '').replace(/\s+/g, ' ').trim();
  return (t || `${fallback} — ${LABEL[kind]}`).slice(0, 120);
}

/** Pure: what a block would be saved as, or null when it is not an artifact kind. */
export function blockPayload(lang: string, code: string, fallbackTitle: string): BlockPayload | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  if (lang === 'html') return { kind: 'html', type: 'HTML', title: titleOf('html', trimmed, fallbackTitle), content: trimmed };
  if (lang === 'svg') return { kind: 'svg', type: 'SVG', title: titleOf('svg', trimmed, fallbackTitle), content: trimmed };
  // A diagram is kept as Markdown holding its fence, which the viewer renders with the same mermaid hook.
  if (lang === 'mermaid') return { kind: 'mermaid', type: 'MD', title: titleOf('mermaid', trimmed, fallbackTitle), content: `\`\`\`mermaid\n${trimmed}\n\`\`\`` };
  return null;
}

/** A short stable hash, so saving the same block twice is recognised. */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** A filename the page can be saved under: its own title, slugified. */
export function fileNameFor(kind: 'html' | 'svg', title: string): string {
  const slug = title.replace(/\s+—\s+(HTML page|SVG image)$/, '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
  return `${slug}.${kind}`;
}

/** "6.1 KB" — the size the file would land on disk as. */
export function fileSize(code: string): string {
  const bytes = new TextEncoder().encode(code).length;
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function makeButton(cls: string, label: string, title: string, kind: BlockPayload['kind'], code: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset.kind = kind;
  b.dataset.code = code;
  b.title = title;
  b.textContent = label;
  return b;
}

/**
 * Turns a `.code-block` holding an html or svg block into the file card, in place: the original
 * head and <pre> stay in the DOM (Copy, highlight.js and the e2e selectors all still find them)
 * but sit behind the toggle.
 */
function makeFileCard(block: HTMLElement, kind: 'html' | 'svg', code: string): void {
  const title = titleOf(kind, code.trim(), 'Untitled');
  block.classList.add(FILE_CARD_CLASS);
  block.dataset.kind = kind;
  block.dataset.code = code;
  block.dataset.fileTitle = title;

  const card = document.createElement('div');
  card.className = 'artifact-card';
  const head = document.createElement('div');
  head.className = 'artifact-card-head';
  const text = document.createElement('div');
  text.className = 'artifact-card-text';
  const name = document.createElement('div');
  name.className = 'artifact-card-title';
  name.textContent = title;
  const meta = document.createElement('div');
  meta.className = 'artifact-card-meta';
  meta.textContent = `${LABEL[kind]} · ${fileSize(code)}`;
  text.append(name, meta);
  head.append(text);

  const actions = document.createElement('div');
  actions.className = 'artifact-card-actions';
  actions.append(
    makeButton(`artifact-card-btn ${PREVIEW_BTN_CLASS}`, 'Preview', 'Open the page in a sandboxed preview', kind, code),
    makeButton(`artifact-card-btn artifact-card-btn-primary ${DOWNLOAD_BTN_CLASS}`, `Download .${kind}`, `Save this as a .${kind} file`, kind, code),
    makeButton(`artifact-card-btn ${SAVE_BTN_CLASS}`, 'Save to artifacts', 'Save to project artifacts', kind, code),
  );

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = `artifact-card-code-toggle ${CODE_TOGGLE_CLASS}`;
  toggle.textContent = 'Show code';
  actions.append(toggle);

  card.append(head, actions);
  block.prepend(card);
}

/** Run before mermaid/highlight (they rewrite the nodes it reads). Idempotent. */
export function addArtifactButtons(root: Element): void {
  root.querySelectorAll<HTMLElement>('.code-block:not([data-artifact-btn])').forEach(block => {
    const code = block.querySelector('pre code');
    const lang = /lang-(html|svg)\b/.exec(code?.className ?? '')?.[1] as 'html' | 'svg' | undefined;
    block.setAttribute('data-artifact-btn', '1');
    if (!lang || !code?.textContent?.trim()) return;
    makeFileCard(block, lang, code.textContent);
  });
  root.querySelectorAll<HTMLElement>('.mermaid.mermaid-block:not([data-artifact-btn])').forEach(node => {
    node.setAttribute('data-artifact-btn', '1');
    const src = node.textContent ?? '';
    if (!src.trim()) return;
    const bar = document.createElement('div');
    bar.className = 'flex justify-end';
    bar.append(makeButton(`${SAVE_BTN_CLASS} code-copy-btn`, 'Save to artifacts', 'Save to project artifacts', 'mermaid', src));
    node.after(bar);
  });
}
