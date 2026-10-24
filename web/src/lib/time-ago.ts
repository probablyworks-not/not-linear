/** app.js:5426 timeAgoShort, verbatim. `now` is injectable so it can be tested. */
export function timeAgoShort(ts: number | undefined, now: number = Date.now()): string {
  if (!ts) return '—';
  const s = (now - ts) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`;
  const mo = d / 30; if (mo < 12) return `${Math.floor(mo)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
