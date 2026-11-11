import { Fragment } from 'react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { crumbTitleOf, restoreMain, type MainSnapshot } from '../branch/actions';

const Sep = () => <span className="text-text-3">/</span>;

/**
 * The trail in the top bar (app.js:3257 renderCrumbs): workspace / project / earlier main
 * states / here. After a branch is promoted, each earlier main state is a link back to it.
 */
export function Breadcrumbs({ threadId, fallbackTitle }: { threadId: string; fallbackTitle: string }) {
  const thread = useAppStore(s => s.threadState[threadId]);
  const projects = useAppStore(s => s.projects);
  const folder = useAppStore(s => s.prefs.folderName) || 'Workspace';
  const setActiveProject = useUiStore(s => s.setActiveProject);
  const pid = typeof thread?.projectId === 'string' ? thread.projectId : undefined;
  const project = pid ? projects[pid] : undefined;
  const history = (Array.isArray(thread?.mainHistory) ? thread!.mainHistory : []) as MainSnapshot[];
  const link = 'rounded-sm text-text-2 hover:text-text hover:underline';

  return (
    <span className="flex min-w-0 items-center gap-2 truncate">
      <Sep />
      <span className="text-text-3">{folder}</span>
      {project && (
        <>
          <Sep />
          <button type="button" className={link} onClick={() => setActiveProject(project.id)}>{project.name || 'Project'}</button>
        </>
      )}
      {history.map((snap, i) => (
        <Fragment key={i}>
          <Sep />
          <button type="button" className={link} onClick={() => { void restoreMain(threadId, i); }}>{snap.title}</button>
        </Fragment>
      ))}
      <Sep />
      <span className="truncate text-text" data-testid="crumb-here">{crumbTitleOf(thread, fallbackTitle)}</span>
    </span>
  );
}
