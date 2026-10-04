// One boolean per P4 leaf feature, so a broken leaf is a flag flip rather than
// a revert. Each feature lands as its own commit behind its flag (handoff, P4
// rollback). Flip to false to hide the feature; its code and tests stay.
export const flags = {
  settings: true,
  modes: true,
  search: true,
  changelog: true,
  projects: true,
} as const;
