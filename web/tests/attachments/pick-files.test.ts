import { pickFiles } from '../../src/attachments/pick-files';

// BUGS.md #021 and #022. The picker has three routes and the ORDER and the
// "fall through, never return early" rule are the whole point:
//   #021  WebKit blocks .click() on a pre-existing hidden input and on any click
//         after an `await`, so under WKWebView/Safari the fresh input must be
//         clicked synchronously, before the function awaits anything.
//   #022  an early return on `cancelled` left the user with no picker at all.

type W = { webkit?: unknown; __notlinearDesktop?: unknown };
let clicks: HTMLInputElement[] = [];
let realClick: typeof HTMLInputElement.prototype.click;

beforeEach(() => {
  clicks = [];
  realClick = HTMLInputElement.prototype.click;
  // jsdom opens no chooser; record the input and let the test fire `change`.
  HTMLInputElement.prototype.click = function (this: HTMLInputElement) { clicks.push(this); };
  delete (window as W).webkit;
  delete (window as W).__notlinearDesktop;
});
afterEach(() => {
  HTMLInputElement.prototype.click = realClick;
  vi.restoreAllMocks();
  document.querySelectorAll('input[type=file]').forEach(i => i.remove());
});

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const flush = () => new Promise(r => setTimeout(r, 0));
// jsdom's File has no .text(); FileReader works in both.
const readText = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f); });

function chooseInBrowser(files: File[]): void {
  const input = clicks.at(-1)!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('route 1: WKWebView / Safari (#021)', () => {
  it('clicks a FRESH input synchronously, before awaiting anything, and never calls the backend', () => {
    (window as W).webkit = {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    void pickFiles();
    // No await has happened yet: the click must already have occurred.
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.type).toBe('file');
    expect(clicks[0]!.multiple).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is also chosen when the desktop shim flag is set', () => {
    (window as W).__notlinearDesktop = true;
    void pickFiles();
    expect(clicks).toHaveLength(1);
  });

  it('folder mode sets webkitdirectory; files mode does not', () => {
    (window as W).webkit = {};
    void pickFiles({ folder: true });
    void pickFiles({ folder: false });
    expect(clicks[0]!.webkitdirectory).toBe(true);
    expect(clicks[1]!.webkitdirectory).toBeFalsy(); // jsdom leaves it undefined unless set
  });

  it('resolves with the chosen files and removes the input', async () => {
    (window as W).webkit = {};
    const p = pickFiles();
    const f = new File(['hi'], 'a.txt');
    const input = clicks[0]!;
    chooseInBrowser([f]);
    expect(await p).toEqual([f]);
    expect(input.isConnected).toBe(false);
  });

  it('the input is off-screen, not display:none (WebKit ignores clicks on display:none inputs)', () => {
    (window as W).webkit = {};
    void pickFiles();
    expect(clicks[0]!.style.display).not.toBe('none');
    expect(clicks[0]!.style.position).toBe('fixed');
  });
});

describe('route 2: the native backend dialog', () => {
  it('delivers the picked files and opens no browser input', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => json({
      ok: true, files: [{ name: 'n.txt', type: 'text/plain', base64: btoa('native!') }, { name: 'skip.bin', tooBig: true }],
    }));
    const files = await pickFiles();
    expect(files.map(f => f.name)).toEqual(['n.txt']);
    expect(await readText(files[0]!)).toBe('native!');
    expect(clicks).toHaveLength(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/__notlinear_open_files');
    expect((init!.headers as Record<string, string>)['X-Notlinear-Local']).toBe('1'); // required by ADR-035
    expect(JSON.parse(init!.body as string)).toEqual({ folder: false });
  });

  it('passes the folder flag through', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => json({ ok: true, files: [{ name: 'a', base64: 'AA==' }] }));
    await pickFiles({ folder: true });
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual({ folder: true });
  });
});

describe('route 3: falling through to the browser input (#022 - never return early)', () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ['the backend reports cancelled', () => json({ ok: false, cancelled: true })],
    ['the backend returns ok with no files', () => json({ ok: true, files: [] })],
    ['every returned file is too big', () => json({ ok: true, files: [{ name: 'big', tooBig: true }] })],
    ['the backend answers with an error status', () => json({ error: 'nope' }, 500)],
    ['the backend is not running', () => Promise.reject(new TypeError('Failed to fetch'))],
  ];
  for (const [name, respond] of cases) {
    it(`opens the browser picker when ${name}`, async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(respond);
      const p = pickFiles();
      await flush();
      expect(clicks).toHaveLength(1);
      const f = new File(['x'], 'b.txt');
      chooseInBrowser([f]);
      expect(await p).toEqual([f]);
    });
  }

  it('folder mode reaches the browser fallback as a directory picker', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json({ ok: false, cancelled: true }));
    void pickFiles({ folder: true });
    await flush();
    expect(clicks[0]!.webkitdirectory).toBe(true);
  });

  it('an empty selection delivers nothing (the user closed the chooser)', async () => {
    (window as W).webkit = {};
    let settled = false;
    void pickFiles().then(() => { settled = true; });
    chooseInBrowser([]);
    await flush();
    expect(settled).toBe(false); // legacy never calls back either; the caller must not block on it
  });
});
