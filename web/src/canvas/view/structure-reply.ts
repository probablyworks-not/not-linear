// Turns a long reply into the sectioned, jump-navigable document the Canvas design calls for —
// applied as a DOM post-process after renderMarkdown(), the same way PartView already runs
// mermaid/highlight.js. Nothing here touches lib/markdown.ts: that renderer's output is dual-write
// surface for the legacy app (ADR-038) and stays string-for-string identical for chat. Canvas reads
// its own rendered DOM and restructures it — the shared renderer never knows this ran.
//
// Three independent passes, in order:
//   - nestListItemBodies: a single-item list (`- Company name` with nothing else in its `<ul>`/
//     `<ol>`) or a lone numbered line (lib/markdown.ts's `.md-number-line`, the form a numbered
//     line takes when the *next* line looks like a label) is a named item, and the plain/label
//     paragraphs right after it are that item's body — but renderMarkdown()'s line-by-line parser
//     has no nesting concept, so it emits them as flat siblings. This pass folds them back under
//     the item they belong to, so a reply built from named items (companies, options, people) reads
//     as indented entries rather than a flat wall of paragraphs at the same left margin as the
//     item label itself (bug #065 round 2). Stops at the next heading/list/number-line, or at an
//     ALL-CAPS label line — that one is left alone for groupCallouts below to turn into its own
//     card, not swallowed as this item's body.
//   - groupCallouts: a `LABEL:` paragraph (lib/markdown.ts already renders this as
//     `<p class="md-label-line">`) becomes a bordered callout card when its label reads as a
//     heading, not a short inline field (e.g. "WHO IT'S FOR:", not "Source:"). Everything between
//     it and the next heading or qualifying label line becomes the card's body.
//   - addSections: when a reply has 2+ top-level headings, they become numbered sections with a
//     "Jump to" pill row. A reply with 0-1 headings is left exactly as rendered — the overhead
//     isn't worth it for a short answer.

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4']);
const SECTION_HEADING_TAGS = new Set(['H1', 'H2']);

const CALLOUT_CLASS = 'nl-callout my-3 rounded-lg border border-cv-edge bg-cv-card-warm px-3 py-2.5';
const CALLOUT_LABEL_CLASS = 'mb-1 font-mono text-xs uppercase tracking-widest text-text-3';
const NAV_CLASS = 'nl-jumpto not-prose mb-4 flex flex-wrap gap-1.5';
const PILL_CLASS = 'nodrag flex items-center gap-1 rounded-md border border-rule-2 px-1.5 py-0.5 text-xs text-text-2 hover:text-text';
const PILL_NUM_CLASS = 'font-mono text-text-3';
const SECTION_CLASS = 'nl-section scroll-mt-3';
const BADGE_CLASS = 'mr-1.5 font-mono text-[0.7em] text-text-3 align-middle';
const NUMBER_ITEM_CLASS = 'nl-number-item pl-[18px]';

function labelReadsAsHeading(label: string): boolean {
  const bare = label.trim();
  return bare.length >= 3 && bare === bare.toUpperCase() && /[A-Z]/.test(bare);
}

/** Moves `afterEl`'s following plain/label-line paragraph siblings into `container`, stopping at
 *  the next heading/list/hr/table/number-line, or at an ALL-CAPS label line (left for
 *  groupCallouts). Returns once nothing more qualifies. */
function absorbBodyInto(container: HTMLElement, afterEl: HTMLElement): void {
  let sib = afterEl.nextSibling;
  while (sib) {
    const next = sib.nextSibling;
    if (!(sib instanceof HTMLElement) || sib.tagName !== 'P') break;
    if (sib.classList.contains('md-number-line')) break;
    if (sib.classList.contains('md-label-line')) {
      const label = sib.querySelector('strong')?.textContent?.replace(/:$/, '').trim();
      if (label && labelReadsAsHeading(label)) break;
    }
    container.appendChild(sib);
    sib = next;
  }
}

function nestListItemBodies(root: HTMLElement): void {
  // A `- Company name` with nothing else in its list: the <li> already indents correctly, so the
  // body paragraphs can be appended straight into it (an <li> may hold block content).
  const soloLists = Array.from(root.querySelectorAll<HTMLElement>(':scope > ul, :scope > ol')).filter(
    l => l.children.length === 1,
  );
  for (const list of soloLists) absorbBodyInto(list.children[0] as HTMLElement, list);

  // A `1. Company name` immediately followed by a label line never becomes a real <li> —
  // lib/markdown.ts's own olm branch renders it as a bare `.md-number-line` paragraph instead
  // (see lib/markdown.ts). A <p> can't contain block children, so wrap it and its absorbed body
  // in a <div> at the same left offset the solo-list case gets from its <ul>'s padding.
  const numberLines = Array.from(root.querySelectorAll<HTMLElement>(':scope > p.md-number-line'));
  for (const p of numberLines) {
    const wrapper = document.createElement('div');
    wrapper.className = NUMBER_ITEM_CLASS;
    p.replaceWith(wrapper); // wrapper now sits where p did, so its siblings are p's old ones
    wrapper.appendChild(p);
    absorbBodyInto(wrapper, wrapper);
  }
}

/** `LABEL:` lines whose label reads as a section heading, plus everything up to the next heading
 *  or qualifying label line, become one callout card. */
function groupCallouts(root: HTMLElement): void {
  const paras = Array.from(root.querySelectorAll<HTMLParagraphElement>('p.md-label-line'));
  for (const p of paras) {
    const strong = p.querySelector('strong');
    const label = strong?.textContent?.replace(/:$/, '').trim();
    if (!label || !labelReadsAsHeading(label)) continue;

    const card = document.createElement('div');
    card.className = CALLOUT_CLASS;
    const labelEl = document.createElement('div');
    labelEl.className = CALLOUT_LABEL_CLASS;
    labelEl.textContent = label;
    card.appendChild(labelEl);

    // Same-line text after the colon, if any, opens the body.
    const rest = Array.from(p.childNodes).slice(1);
    if (rest.some(n => (n.textContent ?? '').trim())) {
      const firstLine = document.createElement('p');
      firstLine.append(...rest);
      card.appendChild(firstLine);
    }

    let sib = p.nextSibling;
    while (sib) {
      const next = sib.nextSibling;
      if (sib instanceof HTMLElement) {
        if (HEADING_TAGS.has(sib.tagName)) break;
        if (sib.tagName === 'P' && sib.classList.contains('md-label-line')) {
          const nextLabel = sib.querySelector('strong')?.textContent?.replace(/:$/, '').trim();
          if (nextLabel && labelReadsAsHeading(nextLabel)) break;
        }
      }
      card.appendChild(sib);
      sib = next;
    }

    p.replaceWith(card);
  }
}

function shortLabel(text: string, max = 24): string {
  // Strip a heading's own leading "1. "/"1) "/"1 - " — the pill already carries its own 01/02 badge,
  // so without this a heading like "1. Major waste streams" doubles up as pill "02 1. Major waste streams".
  const t = text.trim().replace(/^\d+[.)-]\s+/, '');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** 2+ top-level headings become numbered, jump-navigable sections. Fewer than that, left as-is. */
function addSections(root: HTMLElement): void {
  const headings = Array.from(root.children).filter((c): c is HTMLElement => c instanceof HTMLElement && SECTION_HEADING_TAGS.has(c.tagName));
  if (headings.length < 2) return;

  const prefix = root.dataset.part ?? Math.random().toString(36).slice(2, 8);
  const nav = document.createElement('nav');
  nav.className = NAV_CLASS;
  nav.setAttribute('aria-label', 'Jump to section');

  const children = Array.from(root.children);
  const frag = document.createDocumentFragment();
  let current: HTMLElement | null = null;
  let n = 0;

  for (const child of children) {
    if (child instanceof HTMLElement && SECTION_HEADING_TAGS.has(child.tagName)) {
      n += 1;
      const num = String(n).padStart(2, '0');
      const id = `${prefix}-sec-${num}`;
      const label = child.textContent?.trim() ?? '';
      child.id = id;
      const badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      badge.textContent = num;
      child.prepend(badge);

      current = document.createElement('section');
      current.className = SECTION_CLASS;
      current.dataset.section = id;
      frag.appendChild(current);

      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = PILL_CLASS;
      const pillNum = document.createElement('span');
      pillNum.className = PILL_NUM_CLASS;
      pillNum.textContent = num;
      const pillLabel = document.createElement('span');
      pillLabel.textContent = shortLabel(label);
      pill.append(pillNum, pillLabel);
      pill.addEventListener('click', () => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(pill);
    }
    (current ?? frag).appendChild(child);
  }

  root.replaceChildren(nav, frag);
}

export function structureReply(root: HTMLElement): void {
  nestListItemBodies(root);
  groupCallouts(root);
  addSections(root);
}
