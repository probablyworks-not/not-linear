import { postJson } from './api';

// Saving a reply, or a file it produced, from most to least native (app.js addDownloadMdAction),
// because a browser cannot always open a save dialog: (1) the desktop app's WKWebView bridge,
// (2) the local server's save dialog (/__notlinear_save_file), (3) the File System Access API,
// and last a plain download. BUGS #021/#022: a programmatic file picker must be triggered from
// the click itself, so this runs straight from the button's handler.

interface NativeWindow extends Window {
  webkit?: { messageHandlers?: { notlinear?: { postMessage(msg: unknown): void } } };
  showSaveFilePicker?: (opts: unknown) => Promise<{ createWritable(): Promise<{ write(c: string): Promise<void>; close(): Promise<void> }> }>;
}

/** A filename the reply itself suggests: the first `NAME.md` in backticks, with any path stripped. */
export function detectMdFilename(text: string): string | null {
  const m = text.match(/`([A-Z0-9_-][A-Z0-9_\-./]*\.md)`/i);
  return m ? m[1]!.replace(/.*\//, '') : null;
}

export function slugifyTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'response';
}

/** The file kinds a reply can hand over. Every one is text, so they all take the same ladder. */
export type SaveKind = 'md' | 'html' | 'svg';

const KIND: Record<SaveKind, { description: string; mime: string; ext: string }> = {
  md: { description: 'Markdown', mime: 'text/markdown', ext: '.md' },
  html: { description: 'HTML page', mime: 'text/html', ext: '.html' },
  svg: { description: 'SVG image', mime: 'image/svg+xml', ext: '.svg' },
};

export async function saveTextFile(filename: string, content: string, kind: SaveKind = 'md'): Promise<void> {
  const { description, mime, ext } = KIND[kind];
  const w = window as NativeWindow;
  const native = w.webkit?.messageHandlers?.notlinear;
  if (native) { native.postMessage({ action: 'saveFile', filename, content }); return; }
  try {
    const json = await postJson<{ ok?: boolean; cancelled?: boolean }>('/__notlinear_save_file', { filename, content });
    if (json.ok || json.cancelled) return;
  } catch { /* no local server dialog available: fall through */ }
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: filename, types: [{ description, accept: { [mime]: [ext] } }] });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Back-compat alias for the reply's Download .md button. */
export async function saveMarkdownFile(filename: string, content: string): Promise<void> {
  return saveTextFile(filename, content, 'md');
}
