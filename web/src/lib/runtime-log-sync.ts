import { LOCAL_HEADER } from './api';
import { LOG_EVENT, RUNTIME_LOG_SYNC_DEBOUNCE_MS, RUNTIME_LOG_SYNC_ENDPOINT, requestLog } from './request-log';

// Mirrors the request log into logs.md through the local server (app.js:105-168).
//
// Debounced (RUNTIME_LOG_SYNC_DEBOUNCE_MS = 1200) so a burst of events is one
// write, one in flight at a time, and permanently disabled for the page's
// lifetime after the first failure so a missing or refusing server is not
// hammered. Unlike legacy before BUGS.md #055, it sends X-Notlinear-Local: the
// server answers 403 to every /__notlinear_* POST without it.

export type SyncStatus = 'logs.md sync pending' | 'logs.md synced' | 'logs.md sync unavailable';

let timer: ReturnType<typeof setTimeout> | 0 = 0;
let inFlight = false;
let queued = false;
let disabled = false;
let status: SyncStatus = 'logs.md sync pending';
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus): void {
  status = next;
  listeners.forEach(fn => fn());
}

/** Only the local server can write logs.md, so only a page served from it (or localhost) syncs. */
export function canSyncRuntimeLogFile(loc: Pick<Location, 'protocol' | 'hostname'> = location): boolean {
  return loc.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(loc.hostname);
}

export function getSyncStatus(): SyncStatus { return status; }
export function subscribeSyncStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function scheduleRuntimeLogFileSync(): void {
  if (disabled || !canSyncRuntimeLogFile()) {
    setStatus('logs.md sync unavailable');
    return;
  }
  if (timer) clearTimeout(timer);
  setStatus('logs.md sync pending');
  timer = setTimeout(() => { void syncRuntimeLogFile(); }, RUNTIME_LOG_SYNC_DEBOUNCE_MS);
}

export async function syncRuntimeLogFile(): Promise<void> {
  timer = 0;
  if (inFlight) { queued = true; return; }
  inFlight = true;
  try {
    const res = await fetch(RUNTIME_LOG_SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...LOCAL_HEADER },
      body: JSON.stringify({ events: requestLog }),
    });
    if (!res.ok) { disabled = true; setStatus('logs.md sync unavailable'); return; }
    setStatus('logs.md synced');
  } catch {
    disabled = true;
    setStatus('logs.md sync unavailable');
  } finally {
    inFlight = false;
    if (queued && !disabled) { queued = false; scheduleRuntimeLogFileSync(); }
  }
}

let installed = false;
/** Start mirroring: every logged event schedules a (debounced) sync. Idempotent. */
export function installRuntimeLogSync(): void {
  if (installed) return;
  installed = true;
  window.addEventListener(LOG_EVENT, scheduleRuntimeLogFileSync);
}

/** Test seam. */
export function resetRuntimeLogSyncForTests(): void {
  if (timer) clearTimeout(timer);
  timer = 0; inFlight = false; queued = false; disabled = false; status = 'logs.md sync pending';
}
