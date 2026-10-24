import { buildAttachmentContext, type ContextFile } from '../attachments/attachment-context';
import { fileIconKind, fmtSize } from '../attachments/file-kinds';
import { esc } from '../lib/markdown';
import type { Attachment } from '../attachments/read-files';
import type { ContentBlock } from '../providers/types';
import type { ProviderId } from '../providers/types';

// What a user message looks like on the way to the model (app.js:4885-4912) and on the page.
//
// To the model: the attached files become a context block ahead of the question, and Claude is
// additionally sent PDFs and images as native blocks it can read directly. To the page: the
// bubble shows the question and a chip or thumbnail per file. The two are built from the same
// files but are deliberately different things; only the text of the question is saved in the
// message list.

/** Text context plus the question (app.js buildTextUserContent). */
export function buildTextUserContent(text: string, files: readonly Attachment[], options: { nativePdfNames?: ReadonlySet<string>; nativeImageNames?: ReadonlySet<string> } = {}): string {
  const context = buildAttachmentContext(files as readonly ContextFile[], options);
  return context ? `${context}\n\nUser request:\n${text}` : text;
}

/** Claude: PDFs and images as native blocks, everything else as text (app.js buildClaudeUserContent). */
export function buildClaudeUserContent(text: string, files: readonly Attachment[] = []): string | ContentBlock[] {
  const nativePdfs = files.filter(f => f.kind === 'pdf' && f.base64 && !f.tooBig);
  const nativeImages = files.filter(f => f.kind === 'image' && f.base64 && !f.tooBig);
  const body = buildTextUserContent(text, files, {
    nativePdfNames: new Set(nativePdfs.map(f => f.name)),
    nativeImageNames: new Set(nativeImages.map(f => f.name)),
  });
  if (!nativePdfs.length && !nativeImages.length) return body;
  return [
    ...nativePdfs.map(f => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } })),
    ...nativeImages.map(f => ({ type: 'image', source: { type: 'base64', media_type: f.type, data: f.base64 } })),
    { type: 'text', text: body },
  ];
}

/** DeepSeek and the others take text only (app.js buildPlainUserContent). */
export function buildPlainUserContent(text: string, files: readonly Attachment[] = []): string {
  return buildTextUserContent(text, files);
}

export function userContentFor(provider: ProviderId, text: string, files: readonly Attachment[] = []): string | ContentBlock[] {
  return provider === 'claude' ? buildClaudeUserContent(text, files) : buildPlainUserContent(text, files);
}

const TI_ICON: Record<ReturnType<typeof fileIconKind>, string> = { folder: 'ti-folder', pdf: 'ti-file-type-pdf', image: 'ti-photo', file: 'ti-file' };

/**
 * The inside of the user's bubble (app.js:2079-2086): the question, then a thumbnail per image
 * and a chip per other file. The image data is saved in the HTML, as legacy saves it.
 */
export function userBubbleInnerHTML(displayText: string, files: readonly Attachment[] = []): string {
  const imageChips = files.filter(f => f.kind === 'image' && f.base64).map(f =>
    `<img src="data:${f.type};base64,${f.base64}" alt="${esc(f.name)}" style="height:120px;width:120px;object-fit:cover;border-radius:4px;margin-right:6px;margin-bottom:6px;cursor:pointer" class="msg-image" data-name="${esc(f.name)}" />`,
  ).join('');
  const fileChips = files.filter(f => f.kind !== 'image').map(f =>
    `<span class="file-chip"><i class="ti ${TI_ICON[fileIconKind(f)]}"></i><span class="fn" title="${esc(f.name)}">${esc(f.name.split('/').pop() ?? f.name)}</span><span style="color:var(--text-3);font-size:10px;margin-left:2px">${fmtSize(f.size)}</span></span>`,
  ).join('');
  const hasMedia = imageChips || fileChips;
  return `<div style="margin-bottom:${hasMedia ? '8px' : '0'}">${esc(displayText)}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${imageChips}${fileChips}</div>`;
}
