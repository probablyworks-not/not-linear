import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BlockNoteEditor } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/ariakit';
import { FormattingToolbarController, SideMenuController, SuggestionMenuController } from '@blocknote/react';
import '@blocknote/ariakit/style.css';
import { ArrowUp, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import { appliedTheme, onThemeChange } from '../lib/theme';
import { createDebouncedWriter } from '../lib/debounced-writer';
import { captureBaseline, loadNoteBlocks, saveNoteBlocks, type EditorBlock, type NoteSession } from './adapter';
import { saveNoteBlocksTo, saveNoteTitle } from './notes-repo';
import { useNotesStore } from './notes-store';
import { notesSchema, type NotesSchema } from './schema';
import { BackupNotice } from './BackupNotice';
import { NoteHeader } from './NoteHeader';
import { NoteBranchPanel } from './NoteBranchPanel';
import { unwrapBranch, wrapSelectionInBranch, type TransactEditor } from './editor-anchors';
import { addBranch, branchesOf, removeBranch, type NoteBranch } from './notes-repo';
import { uid } from './notes-ops';
import { NoteContext } from './NoteContext';
import { NoteSideMenu, NoteToolbar, applyLastHighlight, mentionItems, slashItems } from './note-menus';
import type { LegacyNote } from './types';

/** Space the open branch drawer takes, so the page slides left instead of sitting under it. */
const NOTE_ROOM = 'calc(var(--nt-drawer-w) + var(--drawer-gap) * 2)';

const writer = createDebouncedWriter();

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('could not read the file'));
    r.readAsDataURL(file);
  });
}

type Opened =
  | { ok: true; editor: BlockNoteEditor<NotesSchema['blockSchema'], NotesSchema['inlineContentSchema'], NotesSchema['styleSchema']>; session: NoteSession }
  | { ok: false; error: string };

/** A note BlockNote cannot load is shown as such and never written to: opening must not be able to damage it. */
function openEditor(blocks: unknown[]): Opened {
  try {
    const loaded = loadNoteBlocks(blocks);
    const editor = BlockNoteEditor.create({
      schema: notesSchema,
      // Cell colours, merging and header toggles have nowhere to be saved in the legacy shape.
      tables: { splitCells: false, cellBackgroundColor: false, cellTextColor: false, headers: false },
      // Images are stored inline as data URLs, as legacy does.
      uploadFile: fileToDataUrl,
      initialContent: loaded.editorBlocks.length > 0 ? (loaded.editorBlocks as never) : undefined,
    });
    captureBaseline(loaded.session, editor.document as unknown as EditorBlock[]);
    return { ok: true, editor, session: loaded.session };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function NoteEditor({ note, editable, compact }: { note: LegacyNote; editable: boolean; compact: boolean }) {
  const [opened] = useState(() => openEditor(note.blocks));
  const store = useNotesStore.getState;
  // BlockNote otherwise follows the OS colour scheme, which can disagree with the app's theme.
  const blockNoteTheme = useSyncExternalStore(onThemeChange, appliedTheme) === 'light' ? 'light' : 'dark';
  const key = `blocks:${note.id}`;
  const titleKey = `title:${note.id}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [openBid, setOpenBid] = useState<string | null>(null);
  const [firstMessage, setFirstMessage] = useState<{ bid: string; text: string } | null>(null);
  const [cta, setCta] = useState('');
  const branches = branchesOf(note);
  const openBranch = branches.find(b => b.bid === openBid) ?? null;

  /** Read on demand by the panel: the anchor's top in the viewport, or null when there is no anchor to sit beside. */
  const getAnchorTop = useCallback((): number | null => {
    if (!openBid) return null;
    const el = wrapRef.current?.querySelector<HTMLElement>(`.nt-br-anchor[data-bid="${CSS.escape(openBid)}"]`);
    return el ? el.getBoundingClientRect().top : null;
  }, [openBid]);

  useEffect(() => {
    store().setKnown(note.id, JSON.stringify(note.blocks));
    return () => { void writer.flush(key); void writer.flush(titleKey); };
    // Mount-only: `note` here is the snapshot this editor was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (): Promise<void> => {
    if (!opened.ok) return;
    try {
      const blocks = saveNoteBlocks(opened.editor.document as unknown as EditorBlock[], opened.session);
      if (await saveNoteBlocksTo(note.id, blocks)) {
        store().setKnown(note.id, JSON.stringify(blocks));
        store().applyBlocks(note.id, blocks);
      }
      store().setDirty(note.id, false);
    } catch (err) {
      toast.error(`Could not save this note: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onBodyChange = (): void => {
    if (!editable) return;
    store().setDirty(note.id, true);
    writer.schedule(key, persist);
  };

  const startBranch = (): void => {
    if (!opened.ok || !editable) return;
    const bid = uid('nb');
    const res = wrapSelectionInBranch(opened.editor as unknown as TransactEditor, bid);
    if (!res.ok) {
      toast({
        empty: 'select some text to branch on', 'unsupported-block': 'select text in a text block to branch',
        'across-blocks': 'select text within one block to branch', 'contains-link-or-atom': 'select plain text, without a link or equation',
        failed: "couldn't branch there",
      }[res.reason]);
      return;
    }
    const now = Date.now();
    const record: NoteBranch = { bid, quote: res.quote, blockId: res.blockId, messages: [], createdAt: now, touchedAt: now };
    void addBranch(note.id, record)
      .then(async () => { await store().load(); setOpenBid(bid); })
      .catch(err => { unwrapBranch(opened.editor as unknown as TransactEditor, bid); toast.error(`Could not branch: ${err instanceof Error ? err.message : String(err)}`); });
  };

  const askAboutNote = (): void => {
    const text = cta.trim();
    if (!text || !editable) return;
    setCta('');
    const bid = uid('nb');
    const now = Date.now();
    void addBranch(note.id, { bid, quote: null, blockId: null, messages: [], createdAt: now, touchedAt: now })
      .then(async () => { await store().load(); setFirstMessage({ bid, text }); setOpenBid(bid); });
  };

  const deleteBranch = (bid: string): void => {
    if (opened.ok) unwrapBranch(opened.editor as unknown as TransactEditor, bid);
    setOpenBid(null);
    void removeBranch(note.id, bid).then(() => store().load());
  };

  const onEditorKeyDown = (e: React.KeyboardEvent): void => {
    if (!opened.ok || !editable || !e.metaKey || e.ctrlKey || e.altKey || !e.shiftKey || e.key.toLowerCase() !== 'h') return;
    e.preventDefault();
    applyLastHighlight(opened.editor);
  };

  const onEditorClick = (e: React.MouseEvent): void => {
    const bid = (e.target as HTMLElement).closest<HTMLElement>('.nt-br-anchor')?.dataset.bid;
    if (bid && !compact && branches.some(b => b.bid === bid)) setOpenBid(bid);
  };

  const onTitleChange = (title: string): void => {
    writer.schedule(titleKey, async () => {
      try { if (await saveNoteTitle(note.id, title)) store().applyTitle(note.id, title); }
      catch (err) { toast.error(`Could not rename this note: ${err instanceof Error ? err.message : String(err)}`); }
    });
  };

  return (
    <div
      // Width is set with the margin, not `w-full`: a full-width box plus a right margin overflows instead of making room.
      className={compact ? 'w-full px-4 py-5' : 'mx-auto w-full max-w-[820px] px-7 py-8 transition-[margin,width] duration-[180ms] ease-out'} data-testid="note-page"
      style={openBranch && !compact ? { marginRight: NOTE_ROOM, width: `calc(100% - ${NOTE_ROOM})` } : undefined}
    >
      <NoteHeader note={note} editable={editable} onTitleChange={onTitleChange} />
      {!editable && <div className="pl-[54px]"><BackupNotice /></div>}
      {opened.ok ? (
        <NoteContext.Provider value={{ noteId: note.id, startBranch }}>
          <div ref={wrapRef} onClick={onEditorClick} onKeyDown={onEditorKeyDown}>
          <BlockNoteView
            editor={opened.editor} editable={editable} onChange={onBodyChange} className="nl-editor" theme={blockNoteTheme}
            slashMenu={false} formattingToolbar={false} sideMenu={false}
          >
            <SuggestionMenuController triggerCharacter="/" getItems={q => slashItems(opened.editor, q)} />
            <SuggestionMenuController triggerCharacter="@" getItems={q => mentionItems(opened.editor, q)} />
            <FormattingToolbarController formattingToolbar={() => <NoteToolbar />} />
            <SideMenuController sideMenu={NoteSideMenu} />
          </BlockNoteView>
          </div>
        </NoteContext.Provider>
      ) : (
        <div role="alert" className="rounded-md border border-rule-2 bg-surface-2 px-3 py-2 text-sm text-text-2">
          This note can&rsquo;t be opened in the new editor yet, so it is shown read-only and nothing was changed.
          Open it in the classic app to edit it. ({opened.error})
        </div>
      )}
      {opened.ok && editable && !compact && (
        <div className="group mx-[54px] mt-7 flex cursor-text items-center gap-2.5 rounded-[10px] border border-rule-2 bg-surface px-3.5 py-2.5 transition-colors focus-within:border-branch" data-testid="note-cta">
          <GitBranch size={15} className="flex-none text-branch" aria-hidden />
          <input
            aria-label="Ask AI about this note" placeholder={'Ask AI about this note\u2026'} value={cta} onChange={e => setCta(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); askAboutNote(); } }}
            className="min-w-0 flex-1 bg-transparent text-[13px] leading-normal text-text-2 outline-none placeholder:text-text-3 focus:text-text"
          />
          <button type="button" aria-label="Ask AI" onClick={askAboutNote} className="grid h-7 w-7 flex-none place-items-center rounded-[7px] bg-branch text-white opacity-0 transition-opacity hover:brightness-110 focus:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100"><ArrowUp size={13} /></button>
        </div>
      )}
      {openBranch && !compact && (
        <div className="branch-stack has-active nl-note-stack">
          <NoteBranchPanel
            key={openBranch.bid} note={note} branch={openBranch} getAnchorTop={getAnchorTop}
            initialMessage={firstMessage?.bid === openBranch.bid ? firstMessage.text : undefined}
            onClose={() => setOpenBid(null)} onDelete={() => deleteBranch(openBranch.bid)}
          />
        </div>
      )}
    </div>
  );
}

/** `compact` is the pane beside a chat: no branch drawer or Ask-AI bar (the chat is right there), tighter padding. */
export function NotePage({ noteId, compact = false }: { noteId: string; compact?: boolean }) {
  const note = useNotesStore(s => s.notes.find(n => n.id === noteId));
  const loaded = useNotesStore(s => s.loaded);
  const revision = useNotesStore(s => s.revisions[noteId] ?? 0);
  const backedUp = useNotesStore(s => s.backup !== null);

  if (!loaded) return <p className="p-8 text-sm text-text-3">Loading&hellip;</p>;
  if (!note) return <p className="p-8 text-sm text-text-3" data-testid="note-missing">This note no longer exists.</p>;
  return <NoteEditor key={`${noteId}:${revision}`} note={note} editable={backedUp} compact={compact} />;
}
