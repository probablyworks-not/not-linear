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
 * Maps whose direct children are generated ids, not field names.
 *
 * Discovered the hard way: the first golden built from a real database had
 * 6,447 paths, because `branchSnapshots` and `branchRecents` are keyed by
 * branch id (`b1790242307893`). A golden that grows a path per branch churns on
 * every branch created and is therefore worthless as a review signal. The
 * synthetic seeds never showed this — they had no branches.
 */
const ID_KEYED_MAPS = [
  'threads',
  'projects',
  'branchSnapshots',
  'branchRecents',
  'prefs.modeOverrides',
  'threadAttachments',
  'branchAttachments',
] as const;

/**
 * Looks like a generated id rather than a field name: a short optional prefix
 * followed by three or more digits (`b1790242307893`, `chat-12`, `h4821`), or a
 * bare timestamp. A backstop for id-keyed maps added later that nobody
 * remembered to list above.
 */
const looksLikeId = (segment: string): boolean =>
  /^[a-z]{0,6}[-_]?\d{3,}$/i.test(segment) || /^[0-9a-f]{8,}$/i.test(segment);

/**
 * Like keyPaths, but collapses the dynamic id segment in maps keyed by id, so
 * adding a thread or a branch does not change the snapshot while a renamed or
 * removed FIELD still does.
 */
export function schemaPaths(state: unknown): string[] {
  const collapse = (path: string): string => {
    let out = path;
    for (const map of ID_KEYED_MAPS) {
      // `map.<id>` -> `map.*`, anywhere in the path, not only at the root.
      out = out.replace(new RegExp(`(^|\\.)${map.replace('.', '\\.')}\\.[^.:[]+`, 'g'), `$1${map}.*`);
    }
    // Backstop: any remaining id-looking segment.
    return out
      .split('.')
      .map((seg) => {
        const [name, ...rest] = seg.split(':');
        return looksLikeId(name ?? '') ? ['*', ...rest].join(':') : seg;
      })
      .join('.');
  };

  return [...new Set(keyPaths(state).map(collapse))].sort();
}
