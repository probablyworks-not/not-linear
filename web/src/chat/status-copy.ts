// The animated "Pondering… / Sleuthing… / Reading closely…" vocabulary shown while a reply is
// worked on (app.js:1935-1980). Purely presentational; the classification of a raw status line
// into a phase is what matters, and it is the part bugs #010-#018 lived in.

export type StatusPhase = 'thinking' | 'searching' | 'reading' | 'synthesizing';

export const STATUS_WORDS: Record<StatusPhase, readonly string[]> = {
  thinking: ['Pondering', 'Cogitating', 'Mulling it over', 'Tracing threads', 'Letting it settle', 'Checking the shape', 'Turning it around'],
  searching: ['Sleuthing', 'Scouring sources', 'Following leads', 'Sifting results', 'Hunting context', 'Combing pages', 'Checking traces'],
  reading: ['Reading closely', 'Skimming signals', 'Parsing the page', 'Gathering context', 'Lifting details'],
  synthesizing: ['Synthesizing', 'Stitching pieces', 'Distilling notes', 'Weaving context', 'Assembling an answer', 'Sharpening the take'],
};

/** A raw status line ("Searching Wikipedia for …", "Reading https://…") → the phase whose words to show. */
export function phaseFromStatus(msg: string | null | undefined): StatusPhase {
  if (!msg) return 'thinking';
  if (/scraping|reading|fetch/i.test(msg)) return 'reading';
  if (/search|google|wikipedia|web/i.test(msg)) return 'searching';
  return 'synthesizing';
}

/** The part of a status line worth showing small next to the word: the query or the URL. */
export function statusDetail(msg: string | null | undefined): string {
  if (!msg) return '';
  return String(msg).replace(/\s*…\s*$/, '').replace(/^(Searching Google for|Searching Wikipedia for|Searching for|Scraping|Reading)\s*/i, '').trim();
}

/** A word from the phase's pool that is not `previous` (app.js:1960). */
export function pickStatusWord(phase: StatusPhase, previous: string | undefined, random: () => number = Math.random): string {
  const pool = STATUS_WORDS[phase] ?? STATUS_WORDS.thinking;
  if (pool.length < 2) return pool[0] || 'Thinking';
  let word = previous;
  while (word === previous) word = pool[Math.floor(random() * pool.length)];
  return word!;
}
