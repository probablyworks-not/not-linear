// Provider API keys, in `localStorage.nl_api_keys` — a flat { provider: key }
// object. That shape and that storage are shared with the legacy app AND with
// frontend/views/notes.js:3101, which parses it directly, so neither may change.
//
// Hard rules (AGENTS.md "Security rules"): a key is never logged, never put in
// a URL, never included in an error message, and is displayed only masked.
// Nothing in this file calls console.* or builds a string containing a key
// except `maskKey`.

export const API_KEYS_STORAGE = 'nl_api_keys';
export type ApiKeys = Record<string, string>;

export function readApiKeys(): ApiKeys {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(API_KEYS_STORAGE) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

/**
 * Read-modify-write against storage itself, not against an in-memory copy: the
 * other app may have added a key since this one last looked, and writing back
 * a stale object would silently delete it.
 */
function update(mutate: (keys: ApiKeys) => void): ApiKeys {
  const keys = readApiKeys();
  mutate(keys);
  try { localStorage.setItem(API_KEYS_STORAGE, JSON.stringify(keys)); } catch { /* storage blocked: the caller sees the unchanged keys */ }
  return readApiKeys();
}

export function connectKey(provider: string, key: string): ApiKeys {
  const trimmed = key.trim();
  if (!trimmed) return readApiKeys();
  return update(keys => { keys[provider] = trimmed; });
}

export function disconnectKey(provider: string): ApiKeys {
  return update(keys => { delete keys[provider]; });
}

/** app.js:4579 maskKey, verbatim: short keys reveal nothing. */
export function maskKey(key: string): string {
  return key.length < 10 ? '••••••••' : key.slice(0, 4) + '••••••••' + key.slice(-4);
}
