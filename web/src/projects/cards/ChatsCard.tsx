import { useState } from 'react';
import { FolderMinus, GitBranch, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { addExistingChat, deleteChat, moveChat, newChatInProject, openProjectChat } from '../../state/actions';
import { useAppStore } from '../../state/app-store';
import { MoveToProjectButton } from '../MoveToProjectButton';
import { shortTime, type ChatRow } from '../project-summary';
import { EmptyBody, SectionCard } from './SectionCard';
import { Glyph } from '../../ui/Glyph';
import { THREAD_ICON_CYCLE } from '../../lib/mind-garden';

const VISIBLE = 5;
const act = 'grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 opacity-0 hover:bg-bg-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100';

export function ChatsCard({ pid, rows, ungrouped, picker, onTogglePicker }: {
  pid: string; rows: ChatRow[]; ungrouped: Array<{ id: string; title: string }>; picker: boolean; onTogglePicker(): void;
}) {
  const [all, setAll] = useState(false);
  const removeFrom = useAppStore(s => s.removeChatFromProject);
  const threads = useAppStore(s => s.threadState);
  const shown = all ? rows : rows.slice(0, VISIBLE);
  const empty = rows.length === 0;

  const pickerEl = picker && (
    <div className="mb-2 rounded-lg border border-rule bg-bg p-1" data-testid="existing-picker">
      {ungrouped.length === 0 && <div className="p-2.5 text-sm text-text-3">No ungrouped chats to add.</div>}
      {ungrouped.map(c => (
        <button key={c.id} type="button" onClick={() => { void addExistingChat(pid, c.id); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-text-2 hover:bg-bg-2 hover:text-text">
          <MessageSquare size={14} aria-hidden className="flex-none" />
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
          <Plus size={14} aria-hidden className="flex-none" />
        </button>
      ))}
    </div>
  );

  return (
    <SectionCard
      accent="neutral" icon={<MessageSquare size={16} aria-hidden />} label="Chats" count={rows.length} empty={empty} span="col-span-6" testId="card-chats"
      action={rows.length > VISIBLE ? (
        <button type="button" onClick={() => setAll(a => !a)} className="text-xs text-branch hover:underline">{all ? 'Show less' : `View all ${rows.length}`}</button>
      ) : undefined}
    >
      {pickerEl}
      {empty ? (
        <div className="rounded-[11px] border border-dashed border-rule-2 px-6 py-8">
          <EmptyBody accent="neutral" icon={<MessageSquare size={24} aria-hidden />} title="Plant the first chat" hint="Chats are the trunk of this project. Notes, branches and artifacts will grow around them.">
            <button type="button" onClick={() => { void newChatInProject(pid); }} className="flex h-[38px] items-center gap-2 rounded-[10px] border border-text bg-text px-4 text-sm text-bg">
              <Pencil size={13} aria-hidden />New chat
            </button>
            <button type="button" onClick={onTogglePicker} aria-expanded={picker} className="h-[38px] rounded-[10px] border border-rule-2 bg-surface px-3.5 text-sm text-text-2 hover:text-text">Add existing chat</button>
          </EmptyBody>
        </div>
      ) : (
        <div>
          {shown.map((r, i) => (
            <div key={r.id} data-chat={r.id} className="group flex items-center gap-3 border-t border-rule px-1.5 py-2.5 first:border-t-0 hover:bg-bg-2">
              <span className="grid w-6 flex-none place-items-center text-text-2">
                <Glyph value={threads[r.id]?.emoji} cycle={THREAD_ICON_CYCLE} index={i} size={20} fallback={<MessageSquare size={15} aria-hidden />} />
              </span>
              <button type="button" onClick={() => { void openProjectChat(r.id); }} className="min-w-0 flex-1 text-left">
                <div className="truncate text-base font-medium text-text">{r.title}</div>
                {r.subtitle && <div className="truncate text-xs text-text-3">{r.subtitle}</div>}
              </button>
              {r.branchCount > 0 && (
                <span data-testid="branch-chip" className="inline-flex flex-none items-center gap-1 rounded-full bg-branch-soft py-0.5 pl-1.5 pr-2 text-xs text-branch">
                  <GitBranch size={12} aria-hidden />{r.branchCount}
                </span>
              )}
              <MoveToProjectButton label={`Move ${r.title} to another project`} current={pid} onMove={to => { void moveChat(r.id, to); }} className={act} />
              <button type="button" title="Remove from project" aria-label={`Remove ${r.title} from project`} onClick={() => { void removeFrom(r.id); }} className={act}><FolderMinus size={13} /></button>
              <button type="button" title="Delete chat" aria-label={`Delete ${r.title}`} onClick={() => { void deleteChat(r.id); }} className={act}><Trash2 size={13} /></button>
              <span className="w-[52px] flex-none text-right font-mono text-xs text-text-3">{shortTime(r.updatedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
