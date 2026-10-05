// Theme application, mirroring app.js:4306 applyTheme. The theme lives in two
// places that must agree: `prefs.theme` (the source of truth, in IndexedDB) and
// `localStorage.nl_theme`, which the pre-paint script in index.html reads to
// avoid a flash. Legacy overwrites the latter from the former on every load,
// so a theme change that wrote only one would be undone on the next legacy load.

export type Theme = 'dark' | 'grey' | 'light';
export const THEME_STORAGE = 'nl_theme';

export function normalizeTheme(t: unknown): Theme {
  return t === 'light' || t === 'grey' ? t : 'dark';
}

export function applyTheme(t: unknown): Theme {
  const theme = normalizeTheme(t);
  if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_STORAGE, theme); } catch { /* the attribute is already applied */ }
  return theme;
}

/** The theme that is on screen right now, read from <html> so it is right before preferences have loaded. */
export function appliedTheme(): Theme {
  return normalizeTheme(document.documentElement.getAttribute('data-theme'));
}

/** Subscribes to theme changes for useSyncExternalStore. */
export function onThemeChange(cb: () => void): () => void {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
