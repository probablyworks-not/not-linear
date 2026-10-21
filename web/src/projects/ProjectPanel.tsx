import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, FilePlus, Folder, FolderMinus, FolderOpen, MessageSquare, NotebookText, Pencil, Plus, Trash2, Unlink } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import {
  addExistingChat, addFilesToProject, moveChat, closeProjectPanel, deleteChat, deleteProjectWithConfirm, linkProjectFolder,
  newChatInProject, openProjectChat, unlinkProjectFolder,
} from '../state/actions';
import { AttachmentRow } from '../attachments/AttachmentRow';
import type { Attachment } from '../attachments/read-files';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import type { LegacyNote } from '../notes/types';
import { flags } from '../flags';
import { useNotesStore } from '../notes/notes-store';
import { moveNoteToProject, newNoteInProject } from '../notes/notes-actions';
import { openNote } from '../notes/open-note';
import { projectNotes } from '../notes/notes-ops';
import { NoteGlyph } from '../notes/NoteGlyph';
import { MoveToProjectButton } from './MoveToProjectButton';
import { projectChatIds, ungroupedChatIds } from '../db/project-ops';
import type { PersistedState } from '../db/types';

/**
 * The single-project screen (index.html #project-panel, app.js:5393). Grid and
 * chat-linking: name, chats (open / remove from project / delete), add or create
 * a chat, delete the project; plus the project's rules, files and linked folder
 * (P4 item 5). How those reach a model is chat work (P5).
 */
export function ProjectPanel() {
  const pid = useUiStore(s => s.activeProjectId);
  const open = pid !== null;
  useEscLayer('projectPanel', ESC_PRIORITY.projectPanel, open, closeProjectPanel);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) closeProjectPanel(); }}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined} onEscapeKeyDown={e => e.preventDefault()}
          onOpenAutoFocus={e => e.preventDefault()}
          className="fixed inset-0 z-[150] flex flex-col bg-bg"
        >
          {pid && <PanelBody pid={pid} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PanelBody({ pid }: { pid: string }) {
  const projects = useAppStore(s => s.projects);
  const project = projects[pid];
  const threads = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const rename = useAppStore(s => s.renameProject);
  const removeFrom = useAppStore(s => s.removeChatFromProject);
  const setRules = useAppStore(s => s.setProjectRules);
  const removeFile = useAppStore(s => s.removeProjectFile);
  const selectName = useUiStore(s => s.selectProjectName);
  const allNotes = useNotesStore(s => s.notes);
  const loadNotes = useNotesStore(s => s.load);
  const [picker, setPicker] = useState(false);
  const [notePicker, setNotePicker] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const [rules, setRulesDraft] = useState(project?.rules ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  // The notes list is shared with the sidebar; make sure it is loaded when the panel opens first.
  useEffect(() => { if (flags.notesV2) void loadNotes(); }, [loadNotes]);

  // Legacy focuses and selects a new project's name after a beat (app.js:5390). Focus is an external system.
  useEffect(() => {
    if (!selectName) return;
    const t = setTimeout(() => nameRef.current?.select(), 80);
    return () => clearTimeout(t);
  }, [selectName]);

  if (!project) return null; // deleted from elsewhere while open

  const view = { projects: { [pid]: project }, threads, dynamic, deletedThreads: deleted } as unknown as PersistedState;
  const chatIds = projectChatIds(view, pid);
  const ungrouped = ungroupedChatIds(view);
  const notes = projectNotes(allNotes, pid);
  const ungroupedNotes = allNotes.filter(n => (n.parent ?? null) === null && !(typeof n.projectId === 'string' && projects[n.projectId]));
  const noteTitle = (n: LegacyNote): string => (typeof n.title === 'string' && n.title ? n.title : 'Untitled');
  const titleOf = (id: string): string => (threads[id]?.title as string | undefined) || 'Untitled chat';
  const primary = 'flex items-center gap-1.5 rounded-lg border border-text bg-text px-3 py-2 text-sm font-medium text-bg';
  const ghost = 'flex items-center gap-1.5 rounded-lg border border-rule-2 px-3 py-2 text-sm text-text-2 hover:border-text-2 hover:text-text';
  const row = 'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-2 hover:bg-bg-2 hover:text-text';

  return (
    <>
      <div className="flex items-center gap-3 border-b border-rule px-7 py-3">
        <Dialog.Close aria-label="Back" title="Back" className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text">
          <ArrowLeft size={15} />
        </Dialog.Close>
        <Dialog.Title className="m-0 flex items-center gap-2 text-sm font-normal text-text-2">
          <Folder size={14} aria-hidden /><span data-testid="project-title">{project.name || 'Project'}</span>
        </Dialog.Title>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-7 py-6">
          <input
            ref={nameRef} placeholder="Project name" aria-label="Project name" value={name}
            onChange={e => { setName(e.target.value); void rename(pid, e.target.value); }}
            onBlur={() => { void useAppStore.getState().flushPrefs(); }}
            className="w-full border-none bg-transparent text-[22px] font-semibold text-text outline-none placeholder:text-text-3"
          />
          <div className="flex gap-2">
            <button type="button" className={primary} onClick={() => { void newChatInProject(pid); }}>
              <Pencil size={13} aria-hidden />New chat
            </button>
            <button type="button" className={ghost} onClick={() => setPicker(p => !p)} aria-expanded={picker}>
              <Plus size={13} aria-hidden />Add existing chat
            </button>
            {flags.notesV2 && (
              <>
                <button type="button" className={ghost} onClick={() => { void newNoteInProject(pid); }}>
                  <NotebookText size={13} aria-hidden />New note
                </button>
                <button type="button" className={ghost} onClick={() => setNotePicker(p => !p)} aria-expanded={notePicker}>
                  <Plus size={13} aria-hidden />Add existing note
                </button>
              </>
            )}
          </div>

          <section className="rounded-xl border border-rule bg-surface p-4">
            <div className="mb-2 font-mono text-xs uppercase tracking-widest text-text-3">Chats in this project</div>
            {picker && (
              <div className="mb-2 rounded-lg border border-rule bg-bg p-1" data-testid="existing-picker">
                {ungrouped.length === 0 && <div className="p-2.5 text-sm text-text-3">No ungrouped chats to add.</div>}
                {ungrouped.map(id => (
                  <button key={id} type="button" className={`${row} w-full text-left`} onClick={() => { void addExistingChat(pid, id); }}>
                    <MessageSquare size={14} aria-hidden className="flex-none" />
                    <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
                    <Plus size={14} aria-hidden className="flex-none" />
                  </button>
                ))}
              </div>
            )}
            {chatIds.length === 0 && <div className="p-2.5 text-sm text-text-3">No chats yet — create one below.</div>}
            {chatIds.map(id => (
              <div key={id} data-chat={id} className={`${row} group`}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => { void openProjectChat(id); }}>
                  <MessageSquare size={14} aria-hidden className="flex-none" />
                  <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
                </button>
                <MoveToProjectButton
                  label={`Move ${titleOf(id)} to another project`} current={pid} onMove={to => { void moveChat(id, to); }}
                  className="grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
                />
                <button
                  type="button" title="Remove from project" aria-label={`Remove ${titleOf(id)} from project`}
                  onClick={() => { void removeFrom(id); }}
                  className="grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
                >
                  <FolderMinus size={13} />
                </button>
                <button
                  type="button" title="Delete chat" aria-label={`Delete ${titleOf(id)}`}
                  onClick={() => { void deleteChat(id); }}
                  className="grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </section>

          {flags.notesV2 && (
            <section className="rounded-xl border border-rule bg-surface p-4" data-testid="project-notes">
              <div className="mb-2 font-mono text-xs uppercase tracking-widest text-text-3">Notes in this project</div>
              {notePicker && (
                <div className="mb-2 rounded-lg border border-rule bg-bg p-1" data-testid="existing-note-picker">
                  {ungroupedNotes.length === 0 && <div className="p-2.5 text-sm text-text-3">No ungrouped notes to add.</div>}
                  {ungroupedNotes.map(n => (
                    <button key={n.id} type="button" className={`${row} w-full text-left`} onClick={() => { void moveNoteToProject(n.id, pid); }}>
                      <span className="grid w-[18px] flex-none place-items-center"><NoteGlyph value={n.emoji} size={14} /></span>
                      <span className="min-w-0 flex-1 truncate">{noteTitle(n)}</span>
                      <Plus size={14} aria-hidden className="flex-none" />
                    </button>
                  ))}
                </div>
              )}
              {notes.length === 0 && <div className="p-2.5 text-sm text-text-3">No notes yet — create one above.</div>}
              {notes.map(n => (
                <div key={n.id} data-note={n.id} className={`${row} group`}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => { closeProjectPanel(); openNote(n.id); }}>
                    <span className="grid w-[18px] flex-none place-items-center"><NoteGlyph value={n.emoji} size={14} /></span>
                    <span className="min-w-0 flex-1 truncate">{noteTitle(n)}</span>
                  </button>
                  <MoveToProjectButton
                    label={`Move ${noteTitle(n)} to another project`} current={pid} onMove={to => { void moveNoteToProject(n.id, to); }}
                    className="grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
                  />
                  <button
                    type="button" title="Remove from project" aria-label={`Remove ${noteTitle(n)} from project`}
                    onClick={() => { void moveNoteToProject(n.id, null); }}
                    className="grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
                  >
                    <FolderMinus size={13} />
                  </button>
                </div>
              ))}
            </section>
          )}

          <section className="rounded-xl border border-rule bg-surface p-4">
            <div className="mb-2 font-mono text-xs uppercase tracking-widest text-text-3">Project rules</div>
            <textarea
              rows={6} aria-label="Project rules" value={rules}
              placeholder="Custom instructions the AI follows for every chat in this project, e.g. 'Answer in British English. Always cite sources. Prefer TypeScript examples.'"
              onChange={e => { setRulesDraft(e.target.value); void setRules(pid, e.target.value); }}
              onBlur={() => { void useAppStore.getState().flushPrefs(); }}
              className="w-full resize-y rounded-md border border-rule-2 bg-surface px-2.5 py-2 text-sm text-text placeholder:text-text-3 focus:border-text-2 focus:outline-none"
            />
            <p className="mt-1.5 text-xs leading-normal text-text-3">Applied to every chat in this project, across the main thread and branches.</p>
          </section>

          <section className="rounded-xl border border-rule bg-surface p-4">
            <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-text-3">
              <span className="flex-1">Project files</span>
              {project.path && <span data-testid="project-folder" className="break-all font-mono text-xs normal-case tracking-normal text-text-2">{project.path}</span>}
            </div>
            <AttachmentRow files={project.files as Attachment[]} onRemove={i => { void removeFile(pid, i); }} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={ghost} onClick={() => { void addFilesToProject(pid); }}>
                <FilePlus size={14} aria-hidden />Add files
              </button>
              <button type="button" className={ghost} onClick={() => { void linkProjectFolder(pid); }}>
                <FolderOpen size={14} aria-hidden />Link folder…
              </button>
              {project.path && (
                <button type="button" className={ghost} onClick={() => { void unlinkProjectFolder(pid); }}>
                  <Unlink size={14} aria-hidden />Unlink
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-normal text-text-3">Shared knowledge for every chat in this project — uploaded files, plus an optional linked folder whose matching files are added as context automatically.</p>
          </section>

          <section className="rounded-xl border border-rule bg-surface p-4">
            <button
              type="button" onClick={() => { void deleteProjectWithConfirm(pid); }}
              className="flex w-full items-center gap-[9px] rounded-md border border-rule-2 bg-surface px-2.5 py-2 text-left text-sm text-danger hover:bg-danger-soft"
            >
              <Trash2 size={14} aria-hidden /><span>Delete project</span>
            </button>
            <p className="mt-1.5 text-xs leading-normal text-text-3">The project's chats are kept and moved back to Threads.</p>
          </section>
        </div>
      </div>
    </>
  );
}
