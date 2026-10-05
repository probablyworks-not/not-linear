// One boolean per leaf feature (P4) and per chat sub-phase (P5), so a broken leaf is a flag flip rather than
// a revert. Each feature lands as its own commit behind its flag (handoff, P4
// rollback). Flip to false to hide the feature; its code and tests stay.
export const flags = {
  settings: true,
  modes: true,
  search: true,
  changelog: true,
  projects: true,
  feedback: true,
  logs: true,
  chat: true,
  // P6b: the BlockNote Notes editor. Writes stay locked until a server-confirmed backup exists.
  notesV2: true,
} as const;
