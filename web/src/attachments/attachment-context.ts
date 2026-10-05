import { fmtSize } from './file-kinds';

// The text block that tells the model what was attached (app.js:4838 buildAttachmentContext,
// with its two limits). Used for files attached to a message and for a project's own files in
// the system prompt. The exact wording and limits are prompt text and behaviour.

export const ATTACHMENT_CONTEXT_CHAR_LIMIT = 70_000;
export const ATTACHMENT_FILE_CHAR_LIMIT = 30_000;

/** The fields of an attachment this block reads; a project file, a picked file and an attached branch all fit. */
export interface ContextFile {
  name: string;
  size?: number;
  type?: string;
  kind?: string;
  content?: string;
  tooBig?: boolean;
  unsupported?: boolean;
  parseError?: string | null;
  quote?: string;
}

const safeFileAttr = (name: unknown): string => String(name || '').replace(/[<>"&]/g, ' ');

export interface ContextOptions {
  /** Files sent as native PDF blocks: the text says so instead of repeating them. */
  nativePdfNames?: ReadonlySet<string>;
  /** Files sent as native images: left out of the text. */
  nativeImageNames?: ReadonlySet<string>;
}

export function buildAttachmentContext(files: ReadonlyArray<ContextFile | null | undefined>, options: ContextOptions = {}): string {
  const list = files.filter((f): f is ContextFile => !!f);
  if (!list.length) return '';
  const nativePdfNames = options.nativePdfNames ?? new Set<string>();
  const nativeImageNames = options.nativeImageNames ?? new Set<string>();
  let remaining = ATTACHMENT_CONTEXT_CHAR_LIMIT;
  const parts: string[] = [];

  for (const f of list) {
    if (remaining <= 0) break;
    if (nativeImageNames.has(f.name)) continue;
    let body: string;
    if (nativePdfNames.has(f.name)) body = 'This PDF is attached as a native document block for the model to read.';
    else if (f.content) body = f.content;
    else if (f.tooBig) body = `Not included: file is too large for in-browser attachment reading (${fmtSize(f.size ?? 0)}).`;
    else if (f.unsupported) body = `Not included: ${f.type || 'this file type'} cannot be read as text in the browser.`;
    else if (f.kind === 'pdf' && f.parseError) body = `PDF text extraction failed: ${f.parseError}.`;
    else body = 'No readable text was extracted from this file.';

    if (body.length > ATTACHMENT_FILE_CHAR_LIMIT) body = body.slice(0, ATTACHMENT_FILE_CHAR_LIMIT).trimEnd() + '\n[truncated]';
    if (body.length > remaining) body = body.slice(0, remaining).trimEnd() + '\n[attachment context truncated]';

    const block = f.kind === 'branch'
      ? `<attached_branch quote="${safeFileAttr(f.quote || '')}">\n${body}\n</attached_branch>`
      : `<attached_file name="${safeFileAttr(f.name)}" size="${fmtSize(f.size ?? 0)}" type="${safeFileAttr(f.type || 'unknown')}">\n${body}\n</attached_file>`;
    parts.push(block);
    remaining -= block.length;
  }

  return `Attached context (${list.length} item${list.length === 1 ? '' : 's'}). Use it when relevant, and say when something could not be read.\n\n${parts.join('\n\n')}`;
}
