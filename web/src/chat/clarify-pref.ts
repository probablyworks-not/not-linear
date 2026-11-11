// "Clarify intent first" switch. Kept in localStorage rather than the persisted prefs: that list is
// pinned to exactly the keys the classic app writes (db/chat.ts), and this setting means nothing there.
// On unless switched off.
const KEY = 'nl_clarify_first';

export function getClarifyFirst(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function setClarifyFirst(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked: the switch just won't stick */ }
}
