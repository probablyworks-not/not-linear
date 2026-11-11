import { LOCAL_HEADER } from '../lib/api';

// Native pickers and why this is shaped the way it is (BUGS.md #021, #022).
//
// Three delivery routes, tried in order:
//   1. WKWebView / Safari (`window.webkit` defined): create a fresh
//      <input type="file"> and click it SYNCHRONOUSLY inside the user gesture.
//      WebKit blocks .click() on a pre-existing display:none input, and on any
//      click that happens after an `await` (#021). So this branch must run
//      before the first await in the function.
//   2. The local backend's /__notlinear_open_files (a native macOS dialog via
//      osascript). If it delivers files, done.
//   3. If the backend is unreachable, cancelled, or returns nothing usable, fall
//      THROUGH to a browser <input> rather than returning (#022 was exactly an
//      early return on `cancelled`, leaving the user with no picker).

interface NativeFile { name: string; type?: string; base64?: string; tooBig?: boolean }
interface OpenFilesResponse { ok?: boolean; cancelled?: boolean; files?: NativeFile[] }

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Creates and clicks a fresh file input. Must be called synchronously from a gesture to work in WebKit. */
function syncFilePicker(folder: boolean, deliver: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  if (folder) input.webkitdirectory = true;
  input.multiple = true;
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    if (files.length) deliver(files);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

interface DesktopWindow { __notlinearDesktop?: unknown; webkit?: unknown }

/**
 * Resolves with the picked files, or an empty array when nothing was chosen.
 * A promise instead of legacy's `onFiles` callback; behaviour is otherwise the
 * same. Note the WebKit branch resolves later than this function returns: the
 * click happens synchronously, the files arrive on the input's change event.
 */
export function pickFiles({ folder = false }: { folder?: boolean } = {}): Promise<File[]> {
  return new Promise<File[]>(resolve => {
    const deliver = (files: File[]): void => resolve(files);
    const w = window as unknown as DesktopWindow;

    // Route 1 - synchronous, before any await.
    if (w.__notlinearDesktop || w.webkit) {
      syncFilePicker(folder, deliver);
      return;
    }

    // Routes 2 and 3.
    void (async () => {
      try {
        const resp = await fetch('/__notlinear_open_files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...LOCAL_HEADER },
          body: JSON.stringify({ folder }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as OpenFilesResponse;
          if (!data.cancelled && data.ok && data.files?.length) {
            const files = data.files
              .filter(f => !f.tooBig && f.base64)
              .map(f => new File([decodeBase64(f.base64!) as BlobPart], f.name, { type: f.type || 'application/octet-stream' }));
            if (files.length) { deliver(files); return; }
          }
          // cancelled, or nothing usable: fall through to the browser picker
        }
      } catch { /* server not running: fall through */ }
      syncFilePicker(folder, deliver);
    })();
  });
}
