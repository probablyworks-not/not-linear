// Single source of truth for all shared mutable app state.
// Imported by app.js (and, after M05, by every feature module).
//
// Initialisation notes:
//   - Simple primitives & empty collections are set here.
//   - DOM-dependent values (threadState) and localStorage-sourced values
//     (apiKeys) are populated by app.js during its init sequence.
//   - prefs defaults are set here; app.js merges saved prefs on top via
//     Object.assign(appState.prefs, savedPrefs).
//
// Relationship to other core/ modules:
//   - core/store.js reads/writes a subset of these fields (threadState,
//     currentThreadId, projects, prefs, etc.) to persist and restore the
//     chat/threads/projects Dexie db named "notlinear". It does NOT own this
//     object — it just serializes/deserializes pieces of it.
//   - core/registry.js, core/feedback.js and the provider modules
//     (frontend/providers/*.js) all import `appState` directly to read the
//     active thread, streaming flags, prefs, etc. There is no setter API —
//     any module that imports this file can mutate it directly, so treat
//     field names here as a de facto shared contract.
//   - Feature views (frontend/views/notes.js)
//     largely keep their own local state instead of writing into appState,
//     except where they need to interoperate with the chat/tab system (e.g.
//     via core/registry.js's chat/note openers).
//
// This is intentionally a single flat object, not a Zustand/Redux-style
// store with actions — there are no subscriptions or change events here.
// Callers that need to react to a change (e.g. the tab strip reacting to the
// active view) use the explicit listener pattern in core/registry.js instead.

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
    thinking: false, theme: 'dark', rankingLlm: 'none',
    customModes: [], modeOverrides: {},   // user-editable modes (core/modes.js)
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
  mainControllers: {},      // { [threadId]: AbortController } — lets app.js abort
                            // an in-flight Claude/DeepSeek/OpenAI stream per thread
                            // (e.g. user switches away or hits stop) without
                            // affecting streams running in other threads/branches.
  _activeController: null, // convenience pointer to the controller for whichever
                            // thread/branch is currently focused; underscore marks
                            // it as an internal/legacy field rather than part of
                            // the stable per-thread/per-branch maps above.

  // ---- Attachments ----
  threadAttachments: {},    // { [threadId]: attachmentArray }
  branchAttachments: {},    // { [branchId]: attachmentArray }

  // ---- API keys (populated from localStorage in app.js) ----
  apiKeys: {},
};
