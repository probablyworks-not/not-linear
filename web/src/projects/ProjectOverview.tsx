import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { deleteProjectWithConfirm } from '../state/actions';
import { flags } from '../flags';
import { projectChatIds, ungroupedChatIds } from '../db/project-ops';
import type { PersistedState } from '../db/types';
import type { Attachment } from '../attachments/read-files';
import { useNotesStore } from '../notes/notes-store';
import { projectNotes } from '../notes/notes-ops';
import { getProjectSources } from './extras/sources';
import { useExtrasStore } from './extras/extras-store';
import { chatRows, metaLine } from './project-summary';
import { ProjectHeader } from './ProjectHeader';
import { ChatsCard } from './cards/ChatsCard';
import { NotesCard } from './cards/NotesCard';
import { ArtifactsCard } from './cards/ArtifactsCard';
import { RulesCard } from './cards/RulesCard';
import { FilesCard } from './cards/FilesCard';
import { MemoryCard } from './cards/MemoryCard';
import { NotesView } from './views/NotesView';
import { FilesView } from './views/FilesView';
import { ArtifactsView } from './views/ArtifactsView';

const NO_ITEMS: never[] = [];

/** Everything on the project screen below the top bar: the overview grid, or one of its drill-in views. */
export function ProjectOverview({ pid }: { pid: string }) {
  const projects = useAppStore(s => s.projects);
  const project = projects[pid];
  const threads = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const rename = useAppStore(s => s.renameProject);
  const setRules = useAppStore(s => s.setProjectRules);
  const view = useUiStore(s => s.projectView);
  const selectName = useUiStore(s => s.selectProjectName);
  const allNotes = useNotesStore(s => s.notes);
  const loadNotes = useNotesStore(s => s.load);
  const artifacts = useExtrasStore(s => s.artifacts[pid]) ?? NO_ITEMS;
  const memory = useExtrasStore(s => s.memory[pid]) ?? NO_ITEMS;
  const extrasError = useExtrasStore(s => s.error[pid]);
  const loadExtras = useExtrasStore(s => s.load);
  const removeMemory = useExtrasStore(s => s.removeMemory);

  const [chatPicker, setChatPicker] = useState(false);
  const [notePicker, setNotePicker] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  // The notes list is shared with the sidebar, and artifacts and memory come from their sources: external systems.
  useEffect(() => { if (flags.notesV2) void loadNotes(); }, [loadNotes]);
  useEffect(() => { void loadExtras(pid); }, [loadExtras, pid]);

  // Legacy focuses and selects a new project's name after a beat (app.js:5390). Focus is an external system.
  useEffect(() => {
    if (!selectName) return undefined;
    const t = setTimeout(() => nameRef.current?.select(), 80);
    return () => clearTimeout(t);
  }, [selectName]);

  if (!project) return null; // deleted from elsewhere while open

  const state = { projects: { [pid]: project }, threads, dynamic, deletedThreads: deleted } as unknown as PersistedState;
  const rows = chatRows(threads, projectChatIds(state, pid));
  const ungrouped = ungroupedChatIds(state).map(id => ({ id, title: (threads[id]?.title as string | undefined) || 'Untitled chat' }));
  const notes = flags.notesV2 ? projectNotes(allNotes, pid) : [];
  const ungroupedNotes = allNotes.filter(n => (n.parent ?? null) === null && !(typeof n.projectId === 'string' && projects[n.projectId]));
  const files = project.files as Attachment[];
  const counts = { chats: rows.length, notes: notes.length, artifacts: artifacts.length, files: files.length };
  const brandNew = rows.length + notes.length + artifacts.length + files.length === 0 && !project.rules.trim() && !project.path;

  if (view === 'notes') return <NotesView pid={pid} projectName={project.name} notes={notes} ungrouped={ungroupedNotes} />;
  if (view === 'files') return <FilesView pid={pid} projectName={project.name} files={files} path={project.path} />;
  if (view === 'artifacts') return <ArtifactsView pid={pid} projectName={project.name} artifacts={artifacts} />;

  return (
    <div data-testid="project-overview">
      <ProjectHeader
        ref={nameRef} pid={pid} name={name} meta={metaLine(counts, project)}
        onName={v => { setName(v); void rename(pid, v); }}
        onAddExistingChat={() => setChatPicker(true)} onAddExistingNote={() => setNotePicker(true)}
        onEditRules={() => setEditingRules(true)} onRename={() => nameRef.current?.select()}
      />
      <div className="grid grid-cols-6 gap-3 max-md:grid-cols-1 [&>*]:max-md:col-span-1">
        <ChatsCard pid={pid} rows={rows} ungrouped={ungrouped} picker={chatPicker} onTogglePicker={() => setChatPicker(p => !p)} />
        {flags.notesV2 && <NotesCard pid={pid} notes={notes} ungrouped={ungroupedNotes} picker={notePicker} onTogglePicker={() => setNotePicker(p => !p)} />}
        <ArtifactsCard artifacts={artifacts} error={extrasError} />
        <RulesCard
          rules={project.rules} editing={editingRules} onEdit={setEditingRules}
          onDraft={v => { void setRules(pid, v); }} onFlush={() => { void useAppStore.getState().flushPrefs(); }}
        />
        <FilesCard pid={pid} names={files.map(f => f.name)} path={project.path} />
        <MemoryCard items={memory} error={extrasError} onRemove={getProjectSources().memory.remove ? id => { void removeMemory(pid, id); } : undefined} />
      </div>
      {brandNew && (
        <div className="mt-7 flex flex-col items-center gap-1.5">
          <button type="button" onClick={() => { void deleteProjectWithConfirm(pid); }} className="flex items-center gap-1.5 text-sm text-danger hover:underline">
            <Trash2 size={14} aria-hidden />Delete project
          </button>
          <p className="m-0 text-xs text-text-3">The project's chats are kept and moved back to Threads.</p>
        </div>
      )}
    </div>
  );
}
