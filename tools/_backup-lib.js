// ---------- notlinear backup library ----------
// Shared read/write helpers for tools/export-data.html and tools/import-data.html.
//
// Deliberately uses the raw IndexedDB API rather than Dexie. Two reasons, both about not touching live data:
//   1. No network dependency — a backup tool must work offline, every time.
//   2. Opening a database with Dexie means declaring a version. Declaring a
//      version that differs from what is on disk triggers an upgrade, which is
//      exactly the schema mutation AGENTS.md calls sacred. Opening with no
//      version (below) attaches to whatever version exists and can never
//      upgrade it.
//
// These tools MUST be served from the same origin as the app
// (http://127.0.0.1:8765) — IndexedDB is origin-scoped, so opening this file
// over file:// or from localhost:NNNN reads a different, empty database.

export const BACKUP_FORMAT = 'notlinear-backup/v1';

// The two databases the app owns. Kept separate per ADR-007 — notes never
// share the chat db, so a backup covers both independently.
export const DB_NAMES = ['notlinear', 'notlinear-notes'];

// requestToPromise: the IndexedDB API predates promises; every call is an
// IDBRequest with onsuccess/onerror. This wraps one so the rest of the file
// can use async/await.
function requestToPromise(request){
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// listExistingDatabases: returns the names of databases that actually exist.
//
// This matters more than it looks. `indexedDB.open(name)` with no version
// CREATES an empty database when one does not exist, so naively opening both
// names would leave behind a stray empty db on a fresh profile. Where
// indexedDB.databases() is available (Chrome, Edge, Safari 14+) we ask first.
// Firefox has no such API, so there we fall back to open-and-detect: if
// onupgradeneeded fires, the db did not exist, and we abort and delete it.
export async function listExistingDatabases(){
  if (typeof indexedDB.databases === 'function'){
    const entries = await indexedDB.databases();
    return entries.map(d => d.name).filter(Boolean);
  }
  const found = [];
  for (const name of DB_NAMES){
    if (await databaseExistsByProbing(name)) found.push(name);
  }
  return found;
}

// databaseExistsByProbing: the Firefox fallback for listExistingDatabases.
// Opens with no version and watches for onupgradeneeded, which only fires for
// a database being created. On that signal we abort the transaction and delete
// the husk, leaving the profile exactly as we found it.
function databaseExistsByProbing(name){
  return new Promise(resolve => {
    let existed = true;
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      existed = false;
      request.transaction.abort();
    };
    request.onsuccess = () => { request.result.close(); resolve(existed); };
    request.onerror = () => {
      // An aborted upgrade lands here. Clean up the empty db we just made.
      if (!existed) indexedDB.deleteDatabase(name);
      resolve(existed);
    };
  });
}

// openExisting: attach to a database without declaring a version, so no
// upgrade can ever run. Rejects rather than creating anything if the database
// turns out not to exist.
function openExisting(name){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      request.transaction.abort();
      reject(new Error(`database "${name}" does not exist`));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`could not open "${name}"`));
  });
}

// dumpDatabase: read every record of every object store in one database.
//
// Store names are discovered from db.objectStoreNames rather than hardcoded to
// 'kv', so if a later schema adds a store this keeps backing it up instead of
// silently skipping it. Records are read with getAll() plus getAllKeys() so
// out-of-line keys survive too, even though both current stores use the
// in-line keyPath 'key'.
export async function dumpDatabase(name){
  const db = await openExisting(name);
  try {
    const storeNames = [...db.objectStoreNames];
    const stores = {};
    for (const storeName of storeNames){
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const [values, keys] = await Promise.all([
        requestToPromise(store.getAll()),
        requestToPromise(store.getAllKeys()),
      ]);
      stores[storeName] = {
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        records: values.map((value, i) => ({ key: keys[i], value })),
      };
    }
    return { version: db.version, stores };
  } finally {
    db.close();
  }
}

// dumpLocalStorage: copy every localStorage key, not just the two the app is
// known to use (nl_api_keys, nl_theme).
//
// Taking everything is deliberate: a partial backup that silently omits a key
// some feature added later is worse than no backup, because it looks complete.
// The cost is that the resulting file contains API keys in plain text — which
// is why both tools say so loudly and why the file belongs outside the repo.
export function dumpLocalStorage(){
  const out = {};
  for (let i = 0; i < localStorage.length; i++){
    const key = localStorage.key(i);
    if (key !== null) out[key] = localStorage.getItem(key);
  }
  return out;
}

// detectRealm: which storage realm this page is running in.
//
// This matters more than the origin does. The desktop app (Notlinear.app) is a
// WKWebView using WKWebsiteDataStore's default store, which lives in the app's
// own container at ~/Library/WebKit/local.notlinear.app/ — NOT shared with
// Chrome or Safari. All three load the same URL, http://127.0.0.1:8765, so the
// origin string is identical while the databases are completely separate.
//
// A backup therefore only ever covers the realm it was taken in, and restoring
// into the wrong one looks like it worked while changing nothing you can see.
// Both tools show this, and it is recorded in the backup file.
export function detectRealm(){
  if (window.webkit?.messageHandlers?.notlinear){
    return { id: 'desktop-app', label: 'Notlinear.app (desktop)' };
  }
  if (window.__notlinearDesktop){
    return { id: 'desktop-shell', label: 'Desktop shell' };
  }
  const ua = navigator.userAgent;
  const name = /Edg\//.test(ua) ? 'Edge'
             : /Chrome\//.test(ua) ? 'Chrome'
             : /Firefox\//.test(ua) ? 'Firefox'
             : /Safari\//.test(ua) ? 'Safari'
             : 'browser';
  return { id: 'browser', label: `${name} (browser)` };
}

// saveTextFile: write a file, trying every save path this app has available.
//
// Mirrors the four-tier cascade in frontend/app.js:738 (addDownloadMdAction),
// deliberately rather than inventing one. The plain <a download> blob fallback
// alone is not enough: WKWebView does not act on a blob download without a
// WKDownloadDelegate, and the desktop app does not implement one — so in the
// app, the tier-4 path silently does nothing. Tier 1 is the app's own save
// bridge and is the only reliable route there.
//
// Returns a short string naming the route taken, so the UI can say what
// happened instead of claiming success it cannot verify.
export async function saveTextFile(filename, content, mime = 'application/json'){
  // 1. Native WKWebView bridge — the desktop app's own save panel.
  if (window.webkit?.messageHandlers?.notlinear){
    window.webkit.messageHandlers.notlinear.postMessage({ action: 'saveFile', filename, content });
    return 'desktop app save dialog';
  }
  // 2. Server-side osascript save dialog.
  try {
    const res = await fetch('/__notlinear_save_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Notlinear-Local': '1' },
      body: JSON.stringify({ filename, content }),
    });
    const json = await res.json();
    if (json.ok) return 'native save dialog (via server)';
    if (json.cancelled) return 'cancelled';
  } catch (_){ /* server not reachable — fall through */ }
  // 3. File System Access API.
  if (window.showSaveFilePicker){
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return 'file picker';
    } catch (err){
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  // 4. Plain blob download.
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'browser download';
}

// createBackup: assemble the whole backup object.
export async function createBackup(){
  const existing = await listExistingDatabases();
  const databases = {};
  const skipped = [];
  for (const name of DB_NAMES){
    if (!existing.includes(name)){ skipped.push(name); continue; }
    databases[name] = await dumpDatabase(name);
  }
  return {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    origin: location.origin,
    realm: detectRealm(),   // see detectRealm — origin alone does NOT identify the data
    userAgent: navigator.userAgent,
    skippedDatabases: skipped,   // absent ≠ empty; record which ones weren't there
    databases,
    localStorage: dumpLocalStorage(),
  };
}

// summarize: a human-readable account of what a backup object contains, used
// by both tools. The point is that you can eyeball "148 threads, 37 notes"
// before trusting a file, rather than reading JSON.
export function summarize(backup){
  const lines = [];
  for (const name of DB_NAMES){
    const db = backup.databases?.[name];
    if (!db){ lines.push(`${name}: not present`); continue; }
    for (const [storeName, store] of Object.entries(db.stores)){
      lines.push(`${name} / ${storeName} (v${db.version}): ${store.records.length} record(s)`);
      for (const rec of store.records) lines.push(`    ${describeRecord(rec)}`);
    }
  }
  const lsKeys = Object.keys(backup.localStorage || {});
  lines.push(`localStorage: ${lsKeys.length} key(s)${lsKeys.length ? ' — ' + lsKeys.join(', ') : ''}`);
  return lines.join('\n');
}

// describeRecord: turn one kv row into a one-line count that means something.
// The chat db keeps everything in a single row under the key 'state', so
// "1 record" is useless on its own — reach inside and count threads, branches
// and highlights. Notes rows are counted by their own shape.
function describeRecord(rec){
  const v = rec.value?.value ?? rec.value;
  const key = String(rec.key);
  if (key === 'state' && v && typeof v === 'object'){
    const threads = v.threads && typeof v.threads === 'object' ? Object.values(v.threads) : [];
    let branches = 0, highlights = 0;
    for (const t of threads){
      if (Array.isArray(t?.branches)) branches += t.branches.length;
      if (Array.isArray(t?.highlights)) highlights += t.highlights.length;
    }
    // projects is an object keyed by project id (see core/store.js
    // loadPersistedState), not an array — counting it as an array
    // silently reported 0 for every real backup.
    const projects = v.projects && typeof v.projects === 'object' ? Object.keys(v.projects).length : 0;
    return `state: ${threads.length} thread(s), ${branches} branch(es), ${highlights} highlight(s), ${projects} project(s)`;
  }
  if (key === 'nl_notes_v1'){
    const notes = Array.isArray(v) ? v : [];
    const blocks = notes.reduce((n, note) => n + (Array.isArray(note?.blocks) ? note.blocks.length : 0), 0);
    return `nl_notes_v1: ${notes.length} note(s), ${blocks} block(s)`;
  }
  if (Array.isArray(v)) return `${key}: ${v.length} item(s)`;
  return `${key}: ${typeof v}`;
}

// restoreDatabase: write a dumped database back.
//
// Records are `put` one by one, which overwrites a row of the same key and
// leaves any row not present in the backup alone. The stores are NOT cleared
// first — a restore should never be able to destroy data the backup did not
// know about. A store named in the backup but missing from the live database
// is reported rather than created, because creating one needs a version
// upgrade and that is a schema change this tool refuses to make.
export async function restoreDatabase(name, dump){
  const db = await openExisting(name);
  const written = [];
  const missingStores = [];
  try {
    for (const [storeName, store] of Object.entries(dump.stores)){
      if (!db.objectStoreNames.contains(storeName)){ missingStores.push(storeName); continue; }
      const tx = db.transaction(storeName, 'readwrite');
      const objectStore = tx.objectStore(storeName);
      for (const rec of store.records){
        // An in-line keyPath store derives the key from the value and rejects
        // an explicit key argument; an out-of-line one requires it.
        if (objectStore.keyPath === null) objectStore.put(rec.value, rec.key);
        else objectStore.put(rec.value);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
      });
      written.push(`${name} / ${storeName}: ${store.records.length} record(s)`);
    }
  } finally {
    db.close();
  }
  return { written, missingStores };
}

// restoreLocalStorage: set each saved key. Like restoreDatabase, this does not
// clear first, so keys added since the backup survive.
export function restoreLocalStorage(entries){
  let count = 0;
  for (const [key, value] of Object.entries(entries || {})){
    localStorage.setItem(key, value);
    count++;
  }
  return count;
}

// validateBackup: reject anything that is not a backup this tool wrote, before
// a single write happens.
export function validateBackup(parsed){
  if (!parsed || typeof parsed !== 'object') return 'file is not a JSON object';
  if (parsed.format !== BACKUP_FORMAT) return `unexpected format "${parsed.format}" (expected "${BACKUP_FORMAT}")`;
  if (!parsed.databases || typeof parsed.databases !== 'object') return 'no "databases" section';
  for (const [name, db] of Object.entries(parsed.databases)){
    if (!db?.stores || typeof db.stores !== 'object') return `database "${name}" has no stores`;
    for (const [storeName, store] of Object.entries(db.stores)){
      if (!Array.isArray(store.records)) return `store "${name}/${storeName}" has no records array`;
    }
  }
  return null;
}
