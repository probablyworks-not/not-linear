import {
  MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_TEXT_FILE_BYTES, PDF_EXTRACT_TIMEOUT_MS,
  arrayBufferToBase64, inferMimeType, isImageFile, isPdfFile, isTextLikeFile,
} from './file-kinds';

/**
 * One attachment as the legacy app stores it (the `files` entries of a project,
 * and the composer's attachments in P5). Extra legacy flags are kept so a row
 * written by either app round-trips.
 */
export interface Attachment {
  name: string;
  size: number;
  type: string;
  kind: 'file' | 'pdf' | 'image' | 'branch';
  content: string | null;
  base64?: string;
  tooBig?: boolean;
  unsupported?: boolean;
  parseError?: string | null;
  quote?: string;
  [extra: string]: unknown;
}

const PDFJS_VERSION = '4.10.38';
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }> }> };
};
let pdfJsPromise: Promise<PdfJs> | null = null;

/**
 * pdf.js is loaded from the same CDN, at the same version, as the legacy app
 * (app.js:4685): adding the package would be a large new dependency for one
 * occasionally-used feature. @vite-ignore stops Vite trying to bundle the URL.
 */
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfJsPromise) {
    pdfJsPromise = (import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`) as Promise<PdfJs>).then(mod => {
      mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;
      return mod;
    });
  }
  return pdfJsPromise;
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  const pages: string[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
    if (text) pages.push(`Page ${pageNo}:\n${text}`);
  }
  return pages.join('\n\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** app.js:4747 readFiles. `extractPdf` is injectable so the PDF path is testable without the network. */
export async function readFiles(
  files: Iterable<File>,
  extractPdf: (buffer: ArrayBuffer) => Promise<string> = extractPdfText,
): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) {
    const name = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const type = inferMimeType(name, f.type);

    if (isPdfFile(name, type)) {
      if (f.size > MAX_PDF_BYTES) {
        out.push({ name, size: f.size, type: 'application/pdf', kind: 'pdf', content: null, tooBig: true });
        continue;
      }
      const buffer = await f.arrayBuffer();
      let content: string | null = null;
      let parseError: string | null = null;
      try {
        content = await withTimeout(extractPdf(buffer), PDF_EXTRACT_TIMEOUT_MS, 'PDF text extraction timed out');
      } catch (e) {
        parseError = (e instanceof Error && e.message) || 'PDF text extraction failed';
        console.warn('notlinear: PDF text extraction failed', e);
      }
      out.push({ name, size: f.size, type: 'application/pdf', kind: 'pdf', content: content || null, base64: arrayBufferToBase64(buffer), parseError });
      continue;
    }

    if (isImageFile(name, type)) {
      if (f.size > MAX_IMAGE_BYTES) {
        out.push({ name, size: f.size, type, kind: 'image', content: null, tooBig: true });
        continue;
      }
      const buffer = await f.arrayBuffer();
      const imgType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type) ? type : 'image/jpeg';
      out.push({ name, size: f.size, type: imgType, kind: 'image', content: null, base64: arrayBufferToBase64(buffer) });
      continue;
    }

    if (f.size > MAX_TEXT_FILE_BYTES) {
      out.push({ name, size: f.size, type, kind: 'file', content: null, tooBig: true });
      continue;
    }
    if (!isTextLikeFile(name, type)) {
      out.push({ name, size: f.size, type, kind: 'file', content: null, unsupported: true });
      continue;
    }
    const text = await f.text().catch(() => null);
    out.push({ name, size: f.size, type, kind: 'file', content: text });
  }
  return out;
}
