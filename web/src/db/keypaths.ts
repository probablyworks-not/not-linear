/**
 * Flattens a persisted value into a sorted set of "dotted.path:type" strings.
 *
 * This is the enforcement mechanism behind the project's existing convention
 * that schema changes must be ADDITIVE (ADR-007, ADR-009, ADR-028 all say so
 * in prose). A snapshot of these paths turns "we agreed to only add fields"
 * into a build failure when something is renamed or removed, and makes every
 * genuinely new field show up as a reviewable diff rather than slipping in.
 *
 * Array elements collapse to a single `[]` segment so that N entries do not
 * produce N paths — the shape is what matters, not the cardinality.
 */
export function keyPaths(value: unknown, prefix = ''): string[] {
  const out = new Set<string>();

  const walk = (v: unknown, path: string): void => {
    if (v === null) { out.add(`${path}:null`); return; }
    if (Array.isArray(v)) {
      out.add(`${path}:array`);
      for (const item of v) walk(item, `${path}[]`);
      return;
    }
    if (typeof v === 'object') {
      out.add(`${path}:object`);
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        walk(child, path ? `${path}.${k}` : k);
      }
      return;
    }
    out.add(`${path}:${typeof v}`);
  };

  walk(value, prefix);
  out.delete(':object');
  return [...out].sort();
}

/**
 * Like keyPaths, but collapses the dynamic id segment in maps keyed by id
 * (threads, projects, modeOverrides) to `*`, so adding a thread does not
 * change the snapshot. Without this the golden would churn on every new chat.
 */
export function schemaPaths(state: unknown): string[] {
  return [...new Set(
    keyPaths(state).map(p =>
      p.replace(/^threads\.[^.:[]+/, 'threads.*')
       .replace(/^projects\.[^.:[]+/, 'projects.*')
       .replace(/^prefs\.modeOverrides\.[^.:[]+/, 'prefs.modeOverrides.*')),
  )].sort();
}
