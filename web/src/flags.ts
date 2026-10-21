// One boolean per leaf feature (P4) and per chat sub-phase (P5), so a broken leaf is a flag flip rather than
// a revert. Each feature lands as its own commit behind its flag (handoff, P4
// rollback). Flip to false to hide the feature; its code and tests stay.
export const flags = {
  settings: true,
  modes: true,
  search: true,
  changelog: true,
  projects: true,
  logs: true,
  chat: true,
  // P6b: the BlockNote Notes editor. Writes stay locked until a server-confirmed backup exists.
  notesV2: true,
  // P7: skills seam. SKILL.md library as BM25-selected system-prompt augmentations.
  skills: true,
  // Questions before answers: the model may ask a few clarifying questions, and the answers anchor the reply.
  clarify: true,
  // Chat→Notes: the model may file a long document as a note; a card in the reply opens it in a side pane.
  chatNotes: true,
} as const;
