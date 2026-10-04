import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Folder, FolderMinus, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import {
  addExistingChat, closeProjectPanel, deleteChat, deleteProjectWithConfirm, newChatInProject, openProjectChat,
} from '../state/actions';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { projectChatIds, ungroupedChatIds } from '../db/project-ops';
import type { PersistedState } from '../db/types';

/**
 * The single-project screen (index.html #project-panel, app.js:5393). Grid and
 * chat-linking only: name, chats (open / remove from project / delete), add or
 * create a chat, delete the project. Rules, files and the linked folder arrive
 * with attachments (P4 item 5).
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
  const project = useAppStore(s => s.projects[pid]);
  const threads = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const rename = useAppStore(s => s.renameProject);
  const removeFrom = useAppStore(s => s.removeChatFromProject);
  const selectName = useUiStore(s => s.selectProjectName);
  const [picker, setPicker] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

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
