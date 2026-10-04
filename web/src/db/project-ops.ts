import type { PersistedProject, PersistedState } from './types';
import { BLANK_DOC_CONTENT, MAIN_THREAD_ID, STATIC_THREAD_IDS } from './thread-ops';

// Pure transformations of the persisted row for chat Projects, each mirroring a
// specific legacy function (named in its comment). Membership is stored on the
// THREAD (`threads[id].projectId`) and nowhere else - the single source of
// truth, per app.js:1175. `projects` is an object keyed by id, not an array.
//
// Scope: grid and chat-linking only (handoff P4 item 4). `rules`, `files` and
// `path` are never written here; they pass through untouched.

/** app.js:5382 createProject. The panel's open then stamps `updatedAt` (see touchOnOpen). */
export function createProjectIn(state: PersistedState, now: number): string {
  const id = `proj-${now}`;
  const name = state.projectCount === 1 ? 'New project' : `New project ${state.projectCount}`;
  state.projectCount += 1;
  state.projects[id] = { id, name, rules: '', files: [], path: '' };
  return id;
}

/** app.js:5393 openProjectPanel: `if (!p.updatedAt) p.updatedAt = Date.now()`. */
export function touchOnOpen(state: PersistedState, pid: string, now: number): void {
  const p = state.projects[pid];
  if (p && !p.updatedAt) p.updatedAt = now;
}

/** app.js:5436 touchProjectUpdated. */
export function touchProject(state: PersistedState, pid: string, now: number): void {
  const p = state.projects[pid];
  if (p) p.updatedAt = now;
}

/** app.js:5644 name input handler: set the name and touch. The title is not trimmed or defaulted. */
export function renameProjectIn(state: PersistedState, pid: string, name: string, now: number): boolean {
  const p = state.projects[pid];
  if (!p) return false;
  p.name = name;
  p.updatedAt = now;
  return true;
}

/** app.js:5343 projectChatIds: every persisted thread filed in `pid`, in storage order. */
export function projectChatIds(state: PersistedState, pid: string): string[] {
  return Object.keys(state.threads).filter(id => state.threads[id]?.projectId === pid);
}

/**
 * app.js:5527 ungroupedChatIds: real chats that can be filed into a project.
 * A thread must have persisted state (legacy iterates threadState), must not be
 * the main doc or a `doc`, must have no project, and must still be in the sidebar.
 */
export function ungroupedChatIds(state: PersistedState): string[] {
  const deleted = new Set(state.deletedThreads);
  const inSidebar = new Set([...STATIC_THREAD_IDS, ...state.dynamic.map(d => d.id)].filter(id => !deleted.has(id)));
  return Object.keys(state.threads).filter(id =>
    id !== MAIN_THREAD_ID && state.threads[id]?.kind !== 'doc' && !state.threads[id]?.projectId && inSidebar.has(id));
}

/** app.js:5554 addExistingChatToProject. Does not touch `updatedAt`, as legacy does not. */
export function addChatToProjectIn(state: PersistedState, pid: string, tid: string): boolean {
  if (!state.projects[pid] || !state.threads[tid]) return false;
  state.threads[tid]!.projectId = pid;
  return true;
}

/** app.js:5564 removeChatFromProject. */
export function removeChatFromProjectIn(state: PersistedState, tid: string): boolean {
  if (!state.threads[tid]) return false;
  delete state.threads[tid]!.projectId;
  return true;
}

/**
 * app.js:5576 newChatInProject: the same thread object startNewChat builds, plus
 * `projectId`, and the project is touched. Returns the new thread's id.
 */
export function newChatInProjectIn(state: PersistedState, pid: string, now: number): string | null {
  if (!state.projects[pid]) return null;
  const id = `chat-${now}`;
  const title = state.chatCount <= 1 ? 'Untitled chat' : `Untitled chat ${state.chatCount}`;
  state.chatCount += 1;
  state.threads[id] = {
    kind: 'chat', title, stream: '', docContent: BLANK_DOC_CONTENT,
    tokenIn: 0, tokenCacheHit: 0, tokenOut: 0, cost: 0,
    highlights: [], branchSnapshots: {}, branchRecents: {}, projectId: pid,
  };
  state.dynamic.push({ id, title });
  state.current = id;
  touchProject(state, pid, now);
  return id;
}

/** app.js:5632 deleteProject: chats are KEPT and move back to ungrouped Threads. */
export function deleteProjectIn(state: PersistedState, pid: string): boolean {
  if (!state.projects[pid]) return false;
  for (const id of projectChatIds(state, pid)) delete state.threads[id]!.projectId;
  delete state.projects[pid];
  return true;
}

/** Projects in storage order (the order legacy iterates `Object.keys(projects)`). */
export function projectList(state: Pick<PersistedState, 'projects'>): PersistedProject[] {
  return Object.keys(state.projects).map(id => state.projects[id]!).filter(Boolean);
}

/** app.js:5449 grid ordering: filter by name substring, then sort by `updatedAt` desc or name. */
export type ProjectSort = 'updated' | 'name';
export function gridProjects(state: PersistedState, search: string, sort: ProjectSort): PersistedProject[] {
  const q = search.trim().toLowerCase();
  const cards = projectList(state).filter(p => !q || (p.name || '').toLowerCase().includes(q));
  return sort === 'name'
    ? cards.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : cards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** The "N threads" count on a card (app.js:5461). */
export function chatCount(state: PersistedState, pid: string): number {
  return Object.values(state.threads).filter(t => t.projectId === pid).length;
}

// ---- Rules, files and the linked folder (P4 item 5) -------------------------

/** app.js:5663 #project-rules-input: set the text and touch. */
export function setProjectRulesIn(state: PersistedState, pid: string, rules: string, now: number): boolean {
  const p = state.projects[pid];
  if (!p) return false;
  p.rules = rules;
  p.updatedAt = now;
  return true;
}

/**
 * app.js:5694 add files. Stored as text only: the picker's base64 is dropped
 * because project knowledge is injected through the system prompt as text, and
 * keeping it would balloon the persisted state. Touches the project.
 */
export function addProjectFilesIn(state: PersistedState, pid: string, files: Array<{ base64?: unknown } & Record<string, unknown>>, now: number): boolean {
  const p = state.projects[pid];
  if (!p || !files.length) return false;
  const stripped = files.map(f => {
    const copy = { ...f };
    delete copy.base64;
    return copy;
  });
  p.files = [...(Array.isArray(p.files) ? p.files : []), ...stripped];
  p.updatedAt = now;
  return true;
}

/** app.js:5490 remove chip: a splice and a save. Legacy does not touch `updatedAt` here. */
export function removeProjectFileIn(state: PersistedState, pid: string, index: number): boolean {
  const p = state.projects[pid];
  if (!p || !Array.isArray(p.files) || index < 0 || index >= p.files.length) return false;
  p.files = p.files.filter((_f, i) => i !== index);
  return true;
}

/** app.js:5616 / :5630 link and unlink the folder. Does not touch `updatedAt`, as legacy does not. */
export function setProjectPathIn(state: PersistedState, pid: string, path: string): boolean {
  const p = state.projects[pid];
  if (!p) return false;
  p.path = path;
  return true;
}
