import { useEffect, useState, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Bookmark, Code2, Download, Link2Off, Paperclip } from 'lucide-react';
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react';
import { postJson } from '../lib/api';
import { linkLabel } from '../lib/link-text';
import { classifyMediaUrl, humanFileSize, isAllowedFrameSrc, isHttpUrl, readData, transformEmbedUrl } from './embeds';
import { NoteGlyph } from './NoteGlyph';
import { useNoteId } from './NoteContext';
import { createNote } from './notes-repo';
import { useNotesStore } from './notes-store';
import { openNote } from './open-note';

// Rendering and editing for the blocks and inline nodes BlockNote does not have. Everything a block
// stores stays in the legacy fields: a pure-data block keeps them in one JSON `data` prop (see convert.ts).

/** The few editor methods these blocks use, so they do not depend on the full generic schema type. */
interface Ed {
  updateBlock(block: unknown, update: unknown): unknown;
  getBlock(id: string): { props?: Record<string, unknown> } | undefined;
  readonly document: readonly { id: string; type: string; props: Record<string, unknown>; content?: unknown }[];
  onChange(cb: () => void): (() => void) | void;
}
const ed = (editor: unknown): Ed => editor as Ed;

function Card({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div contentEditable={false} className="my-1 rounded-md border border-rule-2 bg-bg-2 px-3 py-2 text-sm text-text-2">
      <span className="mr-2 text-xs uppercase tracking-wide text-text-3">{label}</span>
      {children}
    </div>
  );
}

function UrlForm({ icon, label, placeholder, onSubmit }: { icon: ReactNode; label: string; placeholder: string; onSubmit(url: string): void }) {
  const [url, setUrl] = useState('');
  return (
    <form
      contentEditable={false} className="my-1 flex items-center gap-2 rounded-md border border-dashed border-rule-2 bg-bg-2 px-3 py-2 text-sm text-text-3"
      onSubmit={e => { e.preventDefault(); if (url.trim()) onSubmit(url.trim()); }}
    >
      {icon}
      <input
        aria-label={label} placeholder={placeholder} value={url} onChange={e => setUrl(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
      />
      <button type="submit" className="rounded border border-rule-2 px-2 py-0.5 text-xs text-text-2 hover:bg-bg-3 hover:text-text">Add</button>
    </form>
  );
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');
const patchData = (editor: unknown, block: unknown, data: Record<string, unknown>): void => {
  ed(editor).updateBlock(block, { props: { data: JSON.stringify(data) } });
};

// ---- equations -----------------------------------------------------------------------------------

function tex(source: string, displayMode: boolean): { html: string; error: boolean } {
  try {
    return { html: katex.renderToString(source, { displayMode, throwOnError: true, strict: 'ignore' }), error: false };
  } catch {
    return { html: '', error: true };
  }
}

export const equation = createReactBlockSpec(
  { type: 'equation', propSchema: {}, content: 'plain' },
  {
    render: p => {
      const source = Array.isArray(p.block.content) ? (p.block.content as { text?: string }[]).map(n => n.text ?? '').join('') : '';
      const out = source.trim() ? tex(source, true) : { html: '', error: false };
      return (
        <div className="rounded-md bg-bg-2 px-3 py-2">
          <div ref={p.contentRef} className="font-mono text-sm" data-placeholder="e.g. x^2 + y^2 = z^2" />
          <div contentEditable={false} className="mt-1 overflow-x-auto text-text" data-testid="eq-preview">
            {out.error ? <span className="text-xs text-text-3">That is not valid LaTeX yet.</span> : <span dangerouslySetInnerHTML={{ __html: out.html }} />}
          </div>
        </div>
      );
    },
  },
);

function InlineEq({ p }: { p: { inlineContent: { props: { tex: string; error: boolean } }; updateInlineContent(u: unknown): void } }) {
  const source = p.inlineContent.props.tex;
  const [editing, setEditing] = useState(false);
  const out = source ? tex(source, false) : { html: '', error: true };
  if (editing) {
    return (
      <input
        autoFocus defaultValue={source} aria-label="Edit LaTeX" className="w-40 rounded bg-bg-3 px-1 font-mono text-[0.9em] text-text outline-none"
        onBlur={e => { setEditing(false); commit(e.currentTarget.value); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { setEditing(false); } }}
      />
    );
  }
  function commit(next: string) {
    if (next === source || !next.trim()) return;
    const r = tex(next, false);
    p.updateInlineContent({ type: 'inlineEq', props: { tex: next, inner: r.html || next, error: r.error } });
  }
  return (
    <span
      role="button" tabIndex={0} title="Click to edit" data-tex={source}
      className="nt-eq-inline cursor-pointer rounded px-0.5 hover:bg-bg-3"
      onClick={() => setEditing(true)} onKeyDown={e => { if (e.key === 'Enter') setEditing(true); }}
    >
      {out.error ? <span className="font-mono text-[0.9em]">{source || '(empty equation)'}</span> : <span dangerouslySetInnerHTML={{ __html: out.html }} />}
    </span>
  );
}

export const inlineEq = createReactInlineContentSpec(
  { type: 'inlineEq', propSchema: { tex: { default: '' }, inner: { default: '' }, error: { default: false } }, content: 'none' },
  { render: p => <InlineEq p={p as never} /> },
);

// ---- toggle, callout, divider -----------------------------------------------------------------

const HEADING_CLASS: Record<number, string> = { 1: 'text-[30px] font-semibold', 2: 'text-[24px] font-semibold', 3: 'text-[20px] font-semibold', 4: 'text-[17px] font-semibold' };

export const toggle = createReactBlockSpec(
  { type: 'toggle', propSchema: { headingLevel: { default: 0 }, open: { default: false } }, content: 'inline' },
  {
    render: p => {
      const open = p.block.props.open;
      return (
        <div className="nl-toggle flex items-start gap-1" data-open={open ? 'true' : 'false'}>
          <button
            type="button" contentEditable={false} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}
            onClick={() => ed(p.editor).updateBlock(p.block, { props: { open: !open } })}
            className="mt-0.5 w-4 flex-none select-none text-text-3 hover:text-text"
          >
            {open ? '▾' : '▸'}
          </button>
          <div ref={p.contentRef} className={`flex-1 ${HEADING_CLASS[p.block.props.headingLevel] ?? ''}`} />
        </div>
      );
    },
  },
);

const CALLOUT_EMOJI = ['\u{1F4A1}', '⚠️', '\u{1F4CC}', '✅', '❗', '\u{1F4DD}', '\u{1F525}', '❓'];

export const callout = createReactBlockSpec(
  { type: 'callout', propSchema: { emoji: { default: '' } }, content: 'inline' },
  {
    render: p => {
      const current = p.block.props.emoji || CALLOUT_EMOJI[0]!;
      const next = CALLOUT_EMOJI[(CALLOUT_EMOJI.indexOf(current) + 1) % CALLOUT_EMOJI.length]!;
      return (
        <div className="flex gap-2 rounded-md bg-bg-2 px-3 py-2">
          <button type="button" contentEditable={false} title="Change emoji" aria-label="Change callout emoji" onClick={() => ed(p.editor).updateBlock(p.block, { props: { emoji: next } })}>{current}</button>
          <div ref={p.contentRef} className="flex-1" />
        </div>
      );
    },
  },
);

export const divider = createReactBlockSpec(
  { type: 'divider', propSchema: { data: { default: '{}' } }, content: 'none' },
  { render: () => <hr className="my-3 border-rule-2" /> },
);

// ---- table of contents ---------------------------------------------------------------------------

interface Heading { id: string; level: number; text: string }

function headingsOf(editor: Ed): Heading[] {
  const out: Heading[] = [];
  const walk = (blocks: readonly { id: string; type: string; props: Record<string, unknown>; content?: unknown; children?: unknown }[]) => {
    for (const b of blocks) {
      const level = b.type === 'heading' ? Number(b.props.level) : b.type === 'toggle' ? Number(b.props.headingLevel) : 0;
      if (level >= 1 && level <= 4) {
        const text = Array.isArray(b.content) ? (b.content as { text?: string; content?: { text?: string }[] }[]).map(n => n.text ?? n.content?.map(c => c.text ?? '').join('') ?? '').join('') : '';
        out.push({ id: b.id, level, text });
      }
      if (Array.isArray(b.children)) walk(b.children as never);
    }
  };
  walk(editor.document as never);
  return out;
}

function Toc({ editor }: { editor: Ed }) {
  const [items, setItems] = useState<Heading[]>(() => headingsOf(editor));
  useEffect(() => {
    const off = editor.onChange(() => setItems(headingsOf(editor)));
    return () => { if (typeof off === 'function') off(); };
  }, [editor]);
  return (
    <div contentEditable={false} data-testid="toc" className="my-1 rounded-md border border-rule-2 bg-bg-2 px-3 py-2 text-sm">
      <div className="mb-1 text-xs uppercase tracking-wide text-text-3">Contents</div>
      {items.length === 0 ? <p className="text-text-3">Add a heading and it will show up here.</p> : items.map(h => (
        <button
          key={h.id} type="button" style={{ paddingLeft: (h.level - 1) * 14 }}
          onClick={() => {
            const el = document.querySelector(`[data-id="${CSS.escape(h.id)}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.classList.add('nl-flash'); setTimeout(() => el?.classList.remove('nl-flash'), 1200);
          }}
          className="block w-full truncate text-left text-text-2 hover:text-text"
        >
          {h.text || 'Untitled'}
        </button>
      ))}
    </div>
  );
}

export const toc = createReactBlockSpec(
  { type: 'toc', propSchema: { data: { default: '{}' } }, content: 'none' },
  { render: p => <Toc editor={ed(p.editor)} /> },
);

// ---- page link -------------------------------------------------------------------------------------

function PageLink({ label, target, update }: { label: string; target: string; update(props: Record<string, unknown>): void }) {
  const noteId = useNoteId();
  const found = useNotesStore(s => s.notes.find(n => n.id === target));
  const text = target ? (typeof found?.title === 'string' && found.title ? found.title : 'Untitled') : label || 'Untitled subpage';
  // A plain row: the page's own icon and its title, underlined on hover (legacy `.b.page-link`).
  return (
    <button
      type="button" contentEditable={false} data-testid="page-link"
      className="my-0.5 flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[15px] font-medium text-text hover:bg-bg-2"
      onClick={async () => {
        if (target && found) { openNote(target); return; }
        if (!noteId) return;
        // An unbound link creates its subpage on first click, as legacy does.
        const sub = await createNote(noteId);
        update({ target: sub.id });
        await useNotesStore.getState().load();
        openNote(sub.id);
      }}
    >
      <span className="grid w-[22px] flex-none place-items-center"><NoteGlyph value={found?.emoji} size={18} /></span>
      <span className="truncate">{text}</span>
    </button>
  );
}

export const pageLink = createReactBlockSpec(
  { type: 'pageLink', propSchema: { label: { default: '' }, target: { default: '' } }, content: 'none' },
  { render: p => <PageLink label={p.block.props.label} target={p.block.props.target} update={props => ed(p.editor).updateBlock(p.block, { props })} /> },
);

// ---- media, file, bookmark, embed ------------------------------------------------------------------

const FRAME = 'aspect-video w-full rounded-md border border-rule-2';
const SANDBOX = 'allow-scripts allow-same-origin allow-popups';

export const media = createReactBlockSpec(
  { type: 'media', propSchema: { data: { default: '{}' } }, content: 'none' },
  {
    render: p => {
      const d = readData(p.block.props.data);
      const url = asText(d.url);
      const kind = asText(d.kind);
      if (!url) {
        return (
          <UrlForm
            icon={<span aria-hidden>{'▶'}</span>} label="Video or audio URL" placeholder="paste a video or audio URL (YouTube, Vimeo or a file link)"
            onSubmit={u => { const info = classifyMediaUrl(u); patchData(p.editor, p.block, { ...d, url: u, kind: info.kind, ...(info.embedSrc ? { embedSrc: info.embedSrc } : {}) }); }}
          />
        );
      }
      if ((kind === 'youtube' || kind === 'vimeo') && isAllowedFrameSrc(d.embedSrc)) {
        return <iframe title="Embedded video" className={FRAME} src={d.embedSrc} sandbox={SANDBOX} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" loading="lazy" contentEditable={false} />;
      }
      if (kind === 'video') return <video controls src={url} className="w-full rounded-md" contentEditable={false} />;
      if (kind === 'audio') return <audio controls src={url} className="w-full" contentEditable={false} />;
      return <Card label="Media"><Link2Off size={13} className="mr-1 inline" aria-hidden />can&rsquo;t embed this link &mdash; <a href={url} title={url} target="_blank" rel="noopener noreferrer" className="underline">{linkLabel(url)}</a></Card>;
    },
  },
);

const MAX_FILE = 5 * 1024 * 1024;

export const file = createReactBlockSpec(
  { type: 'file', propSchema: { data: { default: '{}' } }, content: 'none' },
  {
    render: p => {
      const d = readData(p.block.props.data);
      const name = asText(d.name);
      if (!name) {
        const take = (f: File | undefined) => {
          if (!f) return;
          const base = { ...d, name: f.name, mime: f.type || '', size: f.size };
          if (f.size > MAX_FILE) { patchData(p.editor, p.block, { ...base, tooLarge: true }); return; }
          const fr = new FileReader();
          fr.onload = () => patchData(p.editor, p.block, { ...base, src: fr.result });
          fr.readAsDataURL(f);
        };
        return (
          <label
            contentEditable={false} className="my-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-rule-2 bg-bg-2 px-3 py-2 text-sm text-text-3 hover:bg-bg-3"
            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); take(e.dataTransfer.files[0]); }}
          >
            <Paperclip size={14} aria-hidden /> click or drop a file to attach
            <input type="file" aria-label="Attach a file" className="hidden" onChange={e => { take(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        );
      }
      const src = asText(d.src);
      return (
        <div contentEditable={false} className="my-1 flex items-center gap-3 rounded-md border border-rule-2 bg-bg-2 px-3 py-2 text-sm">
          <Paperclip size={15} aria-hidden className="text-text-3" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-text">{name}</div>
            <div className="text-xs text-text-3">{d.tooLarge === true ? 'too large to embed — use a link instead' : humanFileSize(Number(d.size) || 0)}</div>
          </div>
          {d.tooLarge !== true && src.startsWith('data:') && (
            <a href={src} download={name} aria-label={`Download ${name}`} className="text-text-3 hover:text-text"><Download size={15} /></a>
          )}
        </div>
      );
    },
  },
);

async function loadPreview(editor: Ed, id: string, url: string): Promise<void> {
  let patch: Record<string, unknown>;
  try {
    const r = await postJson<{ ok?: boolean; title?: string; description?: string; domain?: string; favicon?: string }>(
      '/__notlinear_link_preview', { url }, AbortSignal.timeout(8000),
    );
    patch = r.ok ? { title: r.title, description: r.description, domain: r.domain, favicon: r.favicon } : { fetchFailed: true };
  } catch { patch = { fetchFailed: true }; }
  const block = editor.getBlock(id);
  if (block) editor.updateBlock(block, { props: { data: JSON.stringify({ ...readData(block.props?.data), ...patch }) } });
}

const BOOKMARK_DOMAIN_OK = (s: string) => /^https?:\/\//i.test(s);

export const bookmark = createReactBlockSpec(
  { type: 'bookmark', propSchema: { data: { default: '{}' } }, content: 'none' },
  {
    render: p => {
      const d = readData(p.block.props.data);
      const url = asText(d.url);
      if (!url) {
        return (
          <UrlForm
            icon={<Bookmark size={14} aria-hidden />} label="URL to bookmark" placeholder="paste a URL to bookmark (https://…)"
            onSubmit={u => {
              if (!isHttpUrl(u)) return;
              patchData(p.editor, p.block, { ...d, url: u, fetchFailed: false });
              void loadPreview(ed(p.editor), p.block.id, u);
            }}
          />
        );
      }
      if (d.fetchFailed === true) {
        return <a href={url} title={url} target="_blank" rel="noopener noreferrer" contentEditable={false} className="my-1 block truncate rounded-md border border-rule-2 bg-bg-2 px-3 py-2 text-sm text-text-2 hover:bg-bg-3">{linkLabel(url)}</a>;
      }
      if (!asText(d.title)) return <Card label="Bookmark">fetching preview&hellip;</Card>;
      const fav = asText(d.favicon);
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" contentEditable={false} className="my-1 block rounded-md border border-rule-2 bg-bg-2 px-3 py-2 hover:bg-bg-3">
          <div className="text-sm text-text">{asText(d.title)}</div>
          {asText(d.description) && <div className="line-clamp-2 text-xs text-text-3">{asText(d.description)}</div>}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-text-3">
            {BOOKMARK_DOMAIN_OK(fav) && <img src={fav} alt="" width={14} height={14} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />}
            <span>{asText(d.domain)}</span>
          </div>
        </a>
      );
    },
  },
);

export const embed = createReactBlockSpec(
  { type: 'embed', propSchema: { data: { default: '{}' } }, content: 'none' },
  {
    render: p => {
      const d = readData(p.block.props.data);
      const url = asText(d.url);
      if (!url) {
        return (
          <UrlForm
            icon={<Code2 size={14} aria-hidden />} label="URL to embed" placeholder="paste a Figma, CodePen or Google Maps link"
            onSubmit={u => {
              const src = transformEmbedUrl(u);
              if (src) { patchData(p.editor, p.block, { ...d, url: u, embedSrc: src }); return; }
              // Not a supported site: it becomes a bookmark, as in legacy.
              ed(p.editor).updateBlock(p.block, { type: 'bookmark', props: { data: JSON.stringify({ url: u, fetchFailed: false }) } });
              void loadPreview(ed(p.editor), p.block.id, u);
            }}
          />
        );
      }
      if (!isAllowedFrameSrc(d.embedSrc)) return <Card label="Embed"><a href={url} title={url} target="_blank" rel="noopener noreferrer" className="underline">{linkLabel(url)}</a></Card>;
      return <iframe title="Embedded page" className={FRAME} src={d.embedSrc} sandbox={SANDBOX} loading="lazy" contentEditable={false} />;
    },
  },
);

// ---- columns and the rest -----------------------------------------------------------------------------

export const columns = createReactBlockSpec({ type: 'columns', propSchema: {}, content: 'none' }, { render: () => <span className="nl-columns-marker" contentEditable={false} /> });

export const column = createReactBlockSpec(
  { type: 'column', propSchema: {}, content: 'none' },
  {
    render: p => (
      p.block.children.length === 0
        ? <button type="button" contentEditable={false} className="w-full rounded-md border border-dashed border-rule-2 px-3 py-2 text-left text-sm text-text-3" onClick={() => ed(p.editor).updateBlock(p.block, { children: [{ type: 'paragraph' }] })}>empty column &mdash; click to add</button>
        : <span className="nl-column-marker" contentEditable={false} />
    ),
  },
);

export const columnsChildren = createReactBlockSpec({ type: 'columnsChildren', propSchema: {}, content: 'none' }, { render: () => <span contentEditable={false} /> });

export const opaque = createReactBlockSpec(
  { type: 'opaque', propSchema: { legacyType: { default: '' } }, content: 'none' },
  { render: p => <Card label="Unsupported">kept as it is ({p.block.props.legacyType || 'unknown'})</Card> },
);
