import { forwardRef } from 'react';
import { FilePlus, Folder, FolderOpen, MoreHorizontal, NotebookText, Pencil, Plus, ScrollText, Trash2, TextCursorInput, MessageSquarePlus, StickyNote } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { addFilesToProject, deleteProjectWithConfirm, linkProjectFolder, newChatInProject, setProjectGlyph } from '../state/actions';
import { newNoteInProject } from '../notes/notes-actions';
import { GlyphButton } from '../ui/GlyphButton';
import { PROJECT_ICON_CYCLE } from '../lib/mind-garden';
import { flags } from '../flags';
import { projectList } from '../db/project-ops';
import { PopMenu } from './PopMenu';

/** Icon tile, meta line, editable name, and the New chat / + / … buttons. */
export const ProjectHeader = forwardRef<HTMLInputElement, {
  pid: string; meta: string; name: string; onName(v: string): void;
  onAddExistingChat(): void; onAddExistingNote(): void; onEditRules(): void; onRename(): void;
}>(function ProjectHeader({ pid, meta, name, onName, onAddExistingChat, onAddExistingNote, onEditRules, onRename }, nameRef) {
  const projects = useAppStore(s => s.projects);
  const idx = Math.max(0, projectList({ projects }).findIndex(p => p.id === pid));
  const icon = (projects[pid] as { emoji?: string } | undefined)?.emoji;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <GlyphButton
        value={icon} cycle={PROJECT_ICON_CYCLE} index={idx} size={26} fallback={<Folder size={22} aria-hidden />} title="Change project icon"
        onPick={t => { void setProjectGlyph(pid, t); }}
        className="grid h-[52px] w-[52px] flex-none cursor-pointer place-items-center rounded-[13px] border border-rule bg-surface text-text-2 hover:border-rule-2"
      />
      <div className="min-w-[220px] flex-1">
        <div data-testid="project-meta" className="font-mono text-xs uppercase tracking-widest text-text-3">{meta}</div>
        <input
          ref={nameRef} placeholder="Project name" aria-label="Project name" value={name}
          onChange={e => onName(e.target.value)}
          onBlur={() => { void useAppStore.getState().flushPrefs(); }}
          className="w-full border-none bg-transparent text-[28px] font-semibold leading-tight tracking-tight text-text outline-none placeholder:text-text-3"
        />
      </div>
      <button
        type="button" onClick={() => { void newChatInProject(pid); }}
        className="flex h-10 items-center gap-2 rounded-[10px] border border-text bg-text px-4 text-base text-bg"
      >
        <Pencil size={14} aria-hidden />New chat
        <kbd className="rounded-[5px] border border-current px-1.5 font-mono text-xs opacity-50">⌘N</kbd>
      </button>
      <PopMenu
        label="Add to project" trigger={<Plus size={16} aria-hidden />}
        items={[
          { label: 'New chat', icon: <MessageSquarePlus size={14} aria-hidden />, onSelect: () => { void newChatInProject(pid); } },
          { label: 'Add existing chat', icon: <Plus size={14} aria-hidden />, onSelect: onAddExistingChat },
          ...(flags.notesV2 ? [
            { label: 'New note', icon: <NotebookText size={14} aria-hidden />, onSelect: () => { void newNoteInProject(pid); } },
            { label: 'Add existing note', icon: <StickyNote size={14} aria-hidden />, onSelect: onAddExistingNote },
          ] : []),
          { label: 'Add files', icon: <FilePlus size={14} aria-hidden />, onSelect: () => { void addFilesToProject(pid); } },
          { label: 'Link folder…', icon: <FolderOpen size={14} aria-hidden />, onSelect: () => { void linkProjectFolder(pid); } },
        ]}
      />
      <PopMenu
        label="Project menu" trigger={<MoreHorizontal size={16} aria-hidden />}
        items={[
          { label: 'Rename project', icon: <TextCursorInput size={14} aria-hidden />, onSelect: onRename },
          { label: 'Edit rules', icon: <ScrollText size={14} aria-hidden />, onSelect: onEditRules },
          { label: 'Delete project', icon: <Trash2 size={14} aria-hidden />, danger: true, onSelect: () => { void deleteProjectWithConfirm(pid); } },
        ]}
      />
    </div>
  );
});
