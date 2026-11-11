// Spike fixture text. Long enough that a node is a real document, not a label.
const PARA = [
  'The canvas is the workspace. A conversation is a spatial object with traceable relationships rather than a full-width chronological feed, which means the reply has to stay readable at a range of widths and zoom levels without reflowing into something unrecognisable.',
  'Selection is the product. If a drag that begins on a word pans the world instead of selecting the sentence, the whole branching gesture is dead on arrival, so the pointer contract has to distinguish text, controls, nested scrolling and canvas movement.',
  'Streaming is not an animation to design around, it is the experience. A token arriving must update one card and nothing else, which pushes the streamed text out of the node array and into a narrow subscription.',
  'Layout is separate from content. Moving, resizing, collapsing or hiding a card changes where it sits and never what the model saw, so the geometry writes and the context manifest cannot share a record.',
  'Provenance outlives the source. A branch points at an immutable revision with a semantic anchor, so editing the original later leaves the old answer interpretable and marks the source changed rather than silently relinking it.',
];

export function proseFor(seed: number, paragraphs = 3): string[] {
  const out: string[] = [];
  for (let i = 0; i < paragraphs; i++) out.push(PARA[(seed + i) % PARA.length] ?? '');
  return out;
}
