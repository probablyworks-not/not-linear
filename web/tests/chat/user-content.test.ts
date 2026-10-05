import { legacyFns } from '../helpers/legacy-source';
import { buildClaudeUserContent, buildPlainUserContent, buildTextUserContent, userBubbleInnerHTML, userContentFor } from '../../src/chat/user-content';
import { userTurnHTML } from '../../src/chat/stream-html';
import type { Attachment } from '../../src/attachments/read-files';

// What the model is sent for a message with attachments is compared with the real legacy builders;
// the bubble markup is checked against the strings legacy writes (app.js:2079-2086).

const file = (over: Partial<Attachment> & { name: string }): Attachment => ({ size: 100, type: 'text/plain', kind: 'file', content: 'body', ...over });
const B64 = 'QUJD'; // "ABC"

const FILE_SETS: Array<[string, Attachment[]]> = [
  ['no files', []],
  ['one text file', [file({ name: 'a.md', content: '# hi' })]],
  ['a folder file keeps its path in the name', [file({ name: 'src/lib/x.ts', content: 'export {}' })]],
  ['a native PDF', [file({ name: 'doc.pdf', type: 'application/pdf', kind: 'pdf', content: 'extracted text', base64: B64 })]],
  ['a native image', [file({ name: 'pic.png', type: 'image/png', kind: 'image', content: null, base64: B64 })]],
  ['a PDF and an image and a text file', [
    file({ name: 'doc.pdf', type: 'application/pdf', kind: 'pdf', content: 'pdf words', base64: B64 }),
    file({ name: 'pic.png', type: 'image/png', kind: 'image', content: null, base64: B64 }),
    file({ name: 'notes.txt', content: 'notes' }),
  ]],
  ['a PDF too big to send natively', [file({ name: 'big.pdf', type: 'application/pdf', kind: 'pdf', content: null, tooBig: true, size: 30_000_000, base64: B64 })]],
  ['an image with no data', [file({ name: 'gone.png', type: 'image/png', kind: 'image', content: null })]],
  ['an unreadable file', [file({ name: 'x.bin', type: 'application/octet-stream', content: null, unsupported: true })]],
  ['an attached branch transcript', [file({ name: 'a branch', kind: 'branch', quote: 'the quote', content: 'User: hi\n\nAssistant: yo', size: 0 })]],
];

describe('the model\'s view of a message (app.js:4885)', () => {
  const legacy = legacyFns<{
    buildTextUserContent(t: string, f: unknown[], o?: unknown): string;
    buildClaudeUserContent(t: string, f: unknown[]): unknown;
    buildPlainUserContent(t: string, f: unknown[]): string;
  }>(
    ['fmtSize', 'safeFileAttr', 'buildAttachmentContext', 'buildTextUserContent', 'buildClaudeUserContent', 'buildPlainUserContent'],
    {}, 'const ATTACHMENT_CONTEXT_CHAR_LIMIT = 70_000; const ATTACHMENT_FILE_CHAR_LIMIT = 30_000;',
    '{ buildTextUserContent, buildClaudeUserContent, buildPlainUserContent }',
  );

  it.each(FILE_SETS)('%s', (_name, files) => {
    expect(buildTextUserContent('question?', files)).toBe(legacy.buildTextUserContent('question?', files));
    expect(buildClaudeUserContent('question?', files)).toEqual(legacy.buildClaudeUserContent('question?', files));
    expect(buildPlainUserContent('question?', files)).toBe(legacy.buildPlainUserContent('question?', files));
  });

  it('Claude gets native blocks, in the order documents, images, text; DeepSeek gets text only', () => {
    const files = FILE_SETS[5]![1];
    const claude = userContentFor('claude', 'q', files) as Array<{ type: string }>;
    expect(claude.map(b => b.type)).toEqual(['document', 'image', 'text']);
    expect(typeof userContentFor('deepseek', 'q', files)).toBe('string');
    expect(userContentFor('deepseek', 'q', files)).toContain('<attached_file name="doc.pdf"');
  });

  it('with no files the message is just the question, as a plain string, for either provider', () => {
    expect(userContentFor('claude', 'just this')).toBe('just this');
    expect(userContentFor('deepseek', 'just this')).toBe('just this');
  });
});

describe('the user bubble (app.js:2079-2086)', () => {
  it('with no files it is exactly the markup a plain message has always had', () => {
    expect(userBubbleInnerHTML('hello <b>')).toBe('<div style="margin-bottom:0">hello &lt;b&gt;</div><div style="display:flex;flex-wrap:wrap;gap:4px"></div>');
    expect(userTurnHTML('t', 'hello <b>', userBubbleInnerHTML('hello <b>'))).toBe(userTurnHTML('t', 'hello <b>'));
  });

  it('an image is a 120px thumbnail you can click; any other file is a chip with an icon, its short name and its size', () => {
    const html = userBubbleInnerHTML('look', [
      file({ name: 'pic "1".png', type: 'image/png', kind: 'image', base64: B64 }),
      file({ name: 'src/x.ts', size: 2048 }),
      file({ name: 'doc.pdf', type: 'application/pdf', kind: 'pdf', size: 3_000_000 }),
    ]);
    expect(html).toContain('<div style="margin-bottom:8px">look</div>');
    expect(html).toContain('<img src="data:image/png;base64,QUJD" alt="pic &quot;1&quot;.png" style="height:120px;width:120px;object-fit:cover;border-radius:4px;margin-right:6px;margin-bottom:6px;cursor:pointer" class="msg-image" data-name="pic &quot;1&quot;.png" />');
    expect(html).toContain('<i class="ti ti-folder"></i><span class="fn" title="src/x.ts">x.ts</span><span style="color:var(--text-3);font-size:10px;margin-left:2px">2KB</span>');
    expect(html).toContain('<i class="ti ti-file-type-pdf"></i><span class="fn" title="doc.pdf">doc.pdf</span>');
    expect(html).toContain('2.9MB');
  });

  it('an image with no data is left out of the bubble, as in legacy', () => {
    expect(userBubbleInnerHTML('x', [file({ name: 'gone.png', type: 'image/png', kind: 'image' })])).not.toContain('<img');
  });
});
