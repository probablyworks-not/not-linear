import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { File as NodeFile } from 'node:buffer';
import {
  arrayBufferToBase64, fmtSize, inferMimeType, isImageFile, isPdfFile, isTextLikeFile,
} from '../../src/attachments/file-kinds';
import { readFiles } from '../../src/attachments/read-files';

// Runs the REAL legacy functions (cut out of app.js and evaluated) against the
// port on a corpus of names, types and sizes. The extension and MIME lists are
// behaviour: a missing "yaml" would silently turn a text file into "unsupported".
const appJs = readFileSync(resolve(__dirname, '../../../frontend/app.js'), 'utf8');

function sliceBalanced(src: string, from: number): string {
  const open = src.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error('unbalanced');
}
const fn = (name: string) => {
  const at = appJs.indexOf(`function ${name}(`);
  // Keep a leading `async`, or the extracted body's awaits are a syntax error.
  return sliceBalanced(appJs, appJs.slice(at - 6, at) === 'async ' ? at - 6 : at);
};
const constant = (name: string) => appJs.match(new RegExp(`^\\s*const ${name} = [^;]+;`, 'm'))![0];

type Legacy = {
  fmtSize(b: number): string;
  inferMimeType(n: string, t?: string): string;
  isPdfFile(n: string, t: string): boolean;
  isTextLikeFile(n: string, t: string): boolean;
  isImageFile(n: string, t: string): boolean;
  arrayBufferToBase64(b: ArrayBuffer): string;
};
const legacy = new Function(`
  ${['fmtSize', 'inferMimeType', 'isPdfFile', 'isTextLikeFile', 'isImageFile', 'arrayBufferToBase64'].map(fn).join('\n')}
  return { fmtSize, inferMimeType, isPdfFile, isTextLikeFile, isImageFile, arrayBufferToBase64 };
`)() as Legacy;

const NAMES = [
  'a.txt', 'A.TXT', 'notes.md', 'r.markdown', 'd.csv', 'd.tsv', 'x.json', 's.js', 's.jsx', 's.ts', 's.tsx', 'c.css', 'i.html', 'f.xml',
  'c.yml', 'c.yaml', 'run.log', 'doc.pdf', 'DOC.PDF', 'p.png', 'p.PNG', 'p.jpg', 'p.jpeg', 'p.gif', 'p.webp', 'p.svg', 'p.bmp',
  'archive.zip', 'word.docx', 'noext', '.hidden', 'dir/sub/file.txt', 'weird.name.with.dots.md', 'a.py', 'a.rs', 'Makefile', '',
];
const TYPES = ['', 'text/plain', 'text/markdown', 'text/html', 'application/json', 'application/xml', 'application/javascript',
  'application/x-javascript', 'application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml', 'application/octet-stream', 'application/zip', 'video/mp4'];

describe('file-kind rules: port vs legacy', () => {
  it('inferMimeType', () => {
    for (const n of NAMES) for (const t of TYPES) expect(inferMimeType(n, t), `${n} | ${t}`).toBe(legacy.inferMimeType(n, t));
    for (const n of NAMES) expect(inferMimeType(n), n).toBe(legacy.inferMimeType(n));
  });
  it('isPdfFile / isTextLikeFile / isImageFile', () => {
    for (const n of NAMES) for (const t of TYPES) {
      expect(isPdfFile(n, t), `pdf ${n} | ${t}`).toBe(legacy.isPdfFile(n, t));
      expect(isTextLikeFile(n, t), `text ${n} | ${t}`).toBe(legacy.isTextLikeFile(n, t));
      expect(isImageFile(n, t), `image ${n} | ${t}`).toBe(legacy.isImageFile(n, t));
    }
  });
  it('fmtSize at every boundary', () => {
    for (const b of [0, 1, 1023, 1024, 1536, 1048575, 1048576, 1572864, 5 * 1048576, 123456789]) expect(fmtSize(b), String(b)).toBe(legacy.fmtSize(b));
  });
  it('arrayBufferToBase64, including buffers larger than its 32 KB chunk', () => {
    for (const n of [0, 1, 2, 3, 100, 0x8000 - 1, 0x8000, 0x8000 + 1, 0x20000 + 7]) {
      const buf = new Uint8Array(n).map((_v, i) => (i * 31 + 7) & 255).buffer;
      expect(arrayBufferToBase64(buf), String(n)).toBe(legacy.arrayBufferToBase64(buf));
    }
  });
  it('the oracle can fail: an extension dropped from the list is detected', () => {
    expect(inferMimeType('a.yaml')).toBe('text/plain');
    expect(legacy.inferMimeType('a.nope')).not.toBe('text/plain');
  });
});

describe('readFiles: port vs the legacy function', () => {
  // The legacy readFiles, cut out with its helpers; PDF extraction is replaced on BOTH sides by the same stub.
  const build = new Function('extractPdfText', `
    ${['MAX_TEXT_FILE_BYTES', 'MAX_PDF_BYTES'].map(constant).join('\n')}
    ${['inferMimeType', 'isPdfFile', 'isTextLikeFile', 'isImageFile', 'arrayBufferToBase64', 'withTimeout', 'readFiles'].map(fn).join('\n')}
    return readFiles;
  `) as (extract: (b: ArrayBuffer) => Promise<string>) => (files: unknown[]) => Promise<unknown[]>;

  const mk = (name: string, body: string | Uint8Array, type = '', rel?: string) => {
    const f = new NodeFile([body], name, { type }) as unknown as File;
    if (rel) Object.defineProperty(f, 'webkitRelativePath', { value: rel });
    return f;
  };
  const big = (n: number) => new Uint8Array(n);

  async function same(files: File[], extract: (b: ArrayBuffer) => Promise<string>) {
    const mine = await readFiles(files, extract);
    const theirs = await build(extract)(files);
    expect(mine).toEqual(theirs);
    return mine;
  }
  const ok = async () => 'Page 1:\nhello';

  it('text-like files are read; others are flagged unsupported', async () => {
    const out = await same([
      mk('a.txt', 'hello'), mk('n.md', '# hi', 'text/markdown'), mk('c.csv', 'a,b\n1,2'), mk('j.json', '{"a":1}', 'application/json'),
      mk('x.docx', 'zzz'), mk('z.zip', 'zzz', 'application/zip'), mk('empty.txt', ''), mk('noext', 'plain'),
    ], ok);
    expect(out.filter(f => (f as { unsupported?: boolean }).unsupported)).toHaveLength(3); // docx, zip, noext
  });

  it('files over 2 MB are marked too big and not read', async () => {
    const out = await same([mk('huge.txt', big(2_000_001)), mk('edge.txt', big(2_000_000))], ok);
    expect((out[0] as { tooBig?: boolean }).tooBig).toBe(true);
    expect((out[1] as { content: string | null }).content).not.toBeNull();
  });

  it('images become base64, with unknown image types coerced to jpeg, and >5 MB are too big', async () => {
    const out = await same([
      mk('p.png', new Uint8Array([1, 2, 3]), 'image/png'), mk('p.gif', new Uint8Array([4]), ''), mk('p.webp', new Uint8Array([5]), 'image/webp'),
      mk('p.svg', '<svg/>', 'image/svg+xml'), mk('hugeimg.png', big(5 * 1024 * 1024 + 1), 'image/png'),
    ], ok);
    // Legacy quirk, reproduced on purpose: a .gif with no MIME type is inferred as
    // application/octet-stream (inferMimeType only knows pdf/md/text), which is not an accepted
    // image type, so it is stored as image/jpeg. A gif WITH a type keeps it.
    expect(out.map(f => (f as { type: string }).type)).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/jpeg', 'image/png']);
    expect((out[4] as { tooBig?: boolean }).tooBig).toBe(true);
  });

  it('PDFs: extracted text plus base64, failures recorded, over 20 MB too big', async () => {
    const fail = async () => { throw new Error('bad pdf'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = await same([mk('d.pdf', new Uint8Array([37, 80, 68, 70]), 'application/pdf')], ok);
    expect(good[0]).toMatchObject({ kind: 'pdf', content: 'Page 1:\nhello', parseError: null });
    const bad = await same([mk('e.pdf', new Uint8Array([1]), 'application/pdf')], fail);
    expect(bad[0]).toMatchObject({ kind: 'pdf', content: null, parseError: 'bad pdf' });
    const empty = await same([mk('f.pdf', new Uint8Array([1]), 'application/pdf')], async () => '');
    expect(empty[0]).toMatchObject({ content: null });
    const huge = await same([mk('g.pdf', big(20_000_001), 'application/pdf')], ok);
    expect(huge[0]).toMatchObject({ tooBig: true });
    warn.mockRestore();
  });

  it('a folder pick keeps the relative path as the name', async () => {
    const out = await same([mk('file.txt', 'in a folder', '', 'myproj/src/file.txt')], ok);
    expect((out[0] as { name: string }).name).toBe('myproj/src/file.txt');
  });
});
