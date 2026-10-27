// Explicit opt-in only: HTML rendering never kicks in from inferred intent, only when the prompt
// itself asks for it. A plain regex, not a model call — zero latency/cost, tune the phrase list
// from real usage rather than reaching for a classifier.
const HTML_TRIGGER = /\b(as html|in html|an html|to html|html version|html page|html report|html table|render(?:ed)? (?:as|in) html|generate\b.*\bhtml)\b/i;

export function wantsHtmlReply(prompt: string): boolean {
  return HTML_TRIGGER.test(prompt);
}

// The base system prompt (system-prompt.ts) already tells the model to wrap an HTML reply in a
// ```html fenced block, because elsewhere that fence becomes a downloadable file card. For the
// Canvas live-rendered surface we want the opposite — the raw document, so it can go straight into
// an iframe's `srcDoc` — so this block explicitly overrides that instruction for this one reply.
export const HTML_REPLY_INSTRUCTIONS = `The user explicitly asked for this reply as HTML. Reply with ONLY the complete, self-contained HTML document — starting with <!doctype html> through </html> — and nothing else: no Markdown, no explanation before or after it, and no surrounding \`\`\`html code fence (that fence is for a different, downloadable-file surface; this one renders the document live, so send the raw tags).
Design it as a minimal, calm reading surface: system-ui sans-serif stack, white backgrounds and black text throughout, including cards, tables, headings, muted labels and links. Always use this light appearance regardless of OS/app theme; do not add dark-mode overrides. Keep paragraph spacing compact (about 0.65em), with modest section padding and 8px-rounded cards/tables. Give selected text a contrasting black foreground on a pale blue selection background. Preserve meaningful chart series colors and use subtle table borders; do not use large empty spacer blocks.
Use real <table> markup for any tabular data (header row, subtle borders, light zebra striping) — never fake a table with spaces or pipes. For charts or bars, use whichever is simplest and renders correctly: inline SVG/CSS bars, or Chart.js loaded via <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script> drawing into a <canvas>.`;

/** Defensive: strip a ```html fence if the model wraps the document in one despite the instruction
 * above, so the iframe still gets a bare document rather than visible fence markers. */
export function extractHtmlDoc(text: string): string {
  const fenced = text.match(/```(?:html|svg)?\s*\n([\s\S]*?)\n?```/i);
  return (fenced?.[1] ?? text).trim();
}
