// Single source of truth for all shared mutable app state.
// Imported by app.js (and, after M05, by every feature module).
//
// Initialisation notes:
//   - Simple primitives & empty collections are set here.
//   - DOM-dependent values (threadState) and localStorage-sourced values
//     (apiKeys) are populated by app.js during its init sequence.
//   - prefs defaults are set here; app.js merges saved prefs on top via
//     Object.assign(appState.prefs, savedPrefs).

export const appState = {
  // ---- Thread / chat ----
  currentThreadId: 'doc-main',
  threadState: {},          // { [threadId]: threadStateObj } — populated by app.js
  mainMessages: [],         // {role, content}[] for the active main thread
  newChatCount: 1,
  mainHistory: [],          // [{title, h1HTML, eyebrow, chatHTML}] breadcrumb stack
  currentCrumbTitle: 'Non-linear chat system for research',

  // ---- User prefs ----
  prefs: {
    name: 'Alex', tone: 'concise', context: '', model: 'sonnet',
    mode: 'general', folderName: 'Workspace', searxngUrl: '',
    thinking: false, theme: 'dark',
  },

  // ---- Projects ----
  projects: {},             // { [projectId]: projectObj }
  projectCount: 1,

  // ---- Branches ----
  branches: {},             // { [branchId]: branchObj }
  activeBranchId: null,

  // ---- Streaming / controllers ----
  mainStreaming: false,
  streamingThreadIds: new Set(),
  mainControllers: {},      // { [threadId]: AbortController }
  _activeController: null,

  // ---- Attachments ----
  threadAttachments: {},    // { [threadId]: attachmentArray }
  branchAttachments: {},    // { [branchId]: attachmentArray }

  // ---- API keys (populated from localStorage in app.js) ----
  apiKeys: {},
};
