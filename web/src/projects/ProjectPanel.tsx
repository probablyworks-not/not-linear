import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Folder } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { closeProjectPanel } from '../state/actions';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { ProjectOverview } from './ProjectOverview';

/**
 * The single-project screen (index.html #project-panel, app.js:5393), redesigned as an overview of cards
 * (Chats, Notes, AI artifacts, Rules, Files, Memory) with drill-in views for Notes, Files and artifacts.
 * Back and Esc step out of a drill-in first, and close the screen from the overview.
 */
export function ProjectPanel() {
  const pid = useUiStore(s => s.activeProjectId);
  const view = useUiStore(s => s.projectView);
  const setView = useUiStore(s => s.setProjectView);
  const open = pid !== null;
  const back = (): void => { if (view === 'overview') closeProjectPanel(); else setView('overview'); };
  useEscLayer('projectPanel', ESC_PRIORITY.projectPanel, open, back);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) closeProjectPanel(); }}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined} onEscapeKeyDown={e => e.preventDefault()}
          onOpenAutoFocus={e => e.preventDefault()}
          className="fixed inset-0 z-[150] flex flex-col bg-bg"
        >
          {pid && <TopBar pid={pid} onBack={back} />}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1040px] px-8 pb-20 pt-8 max-sm:px-4">{pid && <ProjectOverview pid={pid} />}</div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TopBar({ pid, onBack }: { pid: string; onBack(): void }) {
  const name = useAppStore(s => s.projects[pid]?.name);
  return (
    <div className="flex h-[52px] flex-none items-center gap-3.5 border-b border-rule px-6">
      <button type="button" aria-label="Back" title="Back" onClick={onBack} className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text">
        <ArrowLeft size={15} />
      </button>
      <Dialog.Title className="m-0 flex items-center gap-2 text-sm font-normal text-text-2">
        <Folder size={14} aria-hidden /><span data-testid="project-title">{name || 'Project'}</span>
      </Dialog.Title>
    </div>
  );
}
