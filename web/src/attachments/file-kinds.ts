// Ported from app.js:4672-4724. These rules decide whether a picked file is read
// as text, kept as a PDF/image, or reported as unsupported; the exact lists are
// behaviour, so tests/attachments/file-kinds-differential.test.ts runs them
// against the real legacy functions.

export const MAX_TEXT_FILE_BYTES = 2_000_000;
export const MAX_PDF_BYTES = 20_000_000;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PDF_EXTRACT_TIMEOUT_MS = 6000;

export function fmtSize(b: number): string {
  return b < 1024 ? b + 'B' : b < 1048576 ? Math.round(b / 1024) + 'KB' : (b / 1048576).toFixed(1) + 'MB';
}

export function inferMimeType(name: string, type = ''): string {
  if (type) return type;
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (['md', 'markdown'].includes(ext)) return 'text/markdown';
  if (['txt', 'csv', 'tsv', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'yml', 'yaml', 'log'].includes(ext)) return 'text/plain';
  return 'application/octet-stream';
}

export function isPdfFile(name: string, type: string): boolean {
  return type === 'application/pdf' || /\.pdf$/i.test(name);
}

export function isTextLikeFile(name: string, type: string): boolean {
  if (type.startsWith('text/')) return true;
  if (['application/json', 'application/xml', 'application/javascript', 'application/x-javascript'].includes(type)) return true;
  return /\.(md|markdown|txt|csv|tsv|json|js|jsx|ts|tsx|css|html|xml|yml|yaml|log)$/i.test(name);
}

export function isImageFile(name: string, type: string): boolean {
  if (type.startsWith('image/')) return true;
  return /\.(png|jpg|jpeg|gif|webp)$/i.test(name);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** app.js:4906 fileIcon, as a name the UI maps to an icon. */
export function fileIconKind(f: { name: string; kind?: string; type?: string }): 'folder' | 'pdf' | 'image' | 'file' {
  if (f.name.includes('/')) return 'folder';
  if (f.kind === 'pdf' || isPdfFile(f.name, f.type || '')) return 'pdf';
  if (f.kind === 'image') return 'image';
  return 'file';
}
