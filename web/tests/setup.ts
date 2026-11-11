// Vitest setup, run before every test file.
//
// Two things the legacy frontend modules assume about their environment and
// that must be true here, because the schema tests import those modules
// directly rather than reimplementing them:
//
//  1. An IndexedDB implementation. fake-indexeddb/auto installs one onto
//     globalThis, so Dexie works headlessly.
//  2. Dexie as a GLOBAL. frontend/core/store.js is loaded in the browser after
//     a CDN <script> tag defines window.Dexie, so it references a bare `Dexie`
//     with no import (see its header comment). Assigning it here is what makes
//     that module importable under test.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

(globalThis as unknown as { Dexie: typeof Dexie }).Dexie = Dexie;

// jsdom logs "not implemented" for scrolling; the app calls it freely and no test needs it to move anything.
window.scrollTo = (() => {}) as typeof window.scrollTo;
