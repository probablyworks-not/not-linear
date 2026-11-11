// Pure BM25 over weighted fields. No dependency, no network, no model: selection works the same
// whichever provider answers.

const STOP = new Set(('a an and are as at be but by for from has have how i if in into is it its of on or our so than that the their ' +
  'them then there these they this to up was we what when where which who why will with you your can could should would do does did ' +
  'about just also not no yes me my us more most some any all each other such only own same too very').split(' '));

/** Light suffix stemming: enough to match "decisions"/"decision", "comparing"/"compare". */
function stem(w: string): string {
  if (w.length <= 3) return w;
  for (const [suf, rep] of [['ational', 'ate'], ['ies', 'y'], ['ing', ''], ['ed', ''], ['es', ''], ['s', ''], ['e', '']] as const) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, w.length - suf.length) + rep;
  }
  return w;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export interface Doc { id: string; fields: Array<{ text: string; weight: number }> }
export interface Scored { id: string; score: number; matched: string[] }

const K1 = 1.2;
const B = 0.75;

/** Weighted-field BM25 (BM25F-style): each field's term counts are scaled by its weight, then summed. */
export function bm25(docs: Doc[], query: string): Scored[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return [];
  const tfs = docs.map(d => {
    const tf = new Map<string, number>();
    let len = 0;
    for (const f of d.fields) for (const t of tokenize(f.text)) { tf.set(t, (tf.get(t) ?? 0) + f.weight); len += f.weight; }
    return { tf, len };
  });
  const avg = tfs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, tfs.filter(d => d.tf.has(t)).length);
  return docs.map((d, i) => {
    const { tf, len } = tfs[i]!;
    let score = 0;
    const matched: string[] = [];
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / avg))));
      matched.push(t);
    }
    return { id: d.id, score, matched };
  });
}
