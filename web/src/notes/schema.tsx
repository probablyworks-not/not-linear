import {
  BlockNoteSchema, createCodeBlockSpec, createHeadingBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs,
} from '@blocknote/core';
import { createReactInlineContentSpec, createReactStyleSpec } from '@blocknote/react';
import { selectThread } from '../state/actions';
import { openNote } from './open-note';
import { CODE_LANGUAGES, FALLBACK_LANGUAGE } from './code-languages';
import {
  callout, column, columns, columnsChildren, divider, embed, equation, file, inlineEq, media, opaque, pageLink, toc, toggle, bookmark,
} from './custom-blocks';

// The editor schema. Names match what `convert.ts` emits, so the converter's output is
// valid BlockNote input. The inline specs are the point of P6: without them BlockNote
// parses `.nt-br-anchor[data-bid]` and friends away, silently, on the first load.

/** Plain text of an HTML string, never injected as markup. */
function textOf(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content.textContent ?? '';
}

// ---- inline content -------------------------------------------------------------

const branchAnchor = createReactInlineContentSpec(
  { type: 'branchAnchor', propSchema: { bid: { default: '' } }, content: 'styled' },
  { render: (p) => <span ref={p.contentRef} className="nt-br-anchor" data-bid={p.inlineContent.props.bid} /> },
);

const comment = createReactInlineContentSpec(
  { type: 'comment', propSchema: { cid: { default: '' } }, content: 'styled' },
  { render: (p) => <span ref={p.contentRef} className="nt-cmt" data-cid={p.inlineContent.props.cid} /> },
);

/** A chip for a note or a chat; clicking it opens that tab (FEATURES: @-mention). */
const mention = createReactInlineContentSpec(
  { type: 'mention', propSchema: { kind: { default: '' }, id: { default: '' }, text: { default: '' } }, content: 'none' },
  {
    render: (p) => {
      const { kind, id, text } = p.inlineContent.props;
      return (
        <span
          role="link" tabIndex={0} data-kind={kind} data-id={id}
          className="nt-mention cursor-pointer rounded bg-bg-3 px-1 hover:bg-bg-2"
          onClick={() => { if (kind === 'note') openNote(id); else if (kind === 'chat') void selectThread(id); }}
        >
          {text}
        </span>
      );
    },
  },
);

/** Markup the converter could not map. Shown as its text, never injected. */
const raw = createReactInlineContentSpec(
  { type: 'raw', propSchema: { html: { default: '' } }, content: 'none' },
  { render: (p) => <span className="nl-raw rounded bg-bg-3 px-1" data-raw="">{textOf(p.inlineContent.props.html) || '…'}</span> },
);

// ---- styles ----------------------------------------------------------------------

const textColor = createReactStyleSpec(
  { type: 'textColor', propSchema: 'string' },
  { render: (p) => <span ref={p.contentRef} data-color={p.value} /> },
);
const highlight = createReactStyleSpec(
  { type: 'highlight', propSchema: 'string' },
  { render: (p) => <mark ref={p.contentRef} data-c={p.value === 'yellow' ? undefined : p.value} /> },
);

const { paragraph, bulletListItem, numberedListItem, checkListItem, quote, table, image } = defaultBlockSpecs;

// The languages legacy's picker offered, under legacy's own ids so `lang` round-trips unchanged.
const codeBlock = createCodeBlockSpec({ defaultLanguage: FALLBACK_LANGUAGE, supportedLanguages: CODE_LANGUAGES });
const { text, link } = defaultInlineContentSpecs;
const { bold, italic, underline, strike, code } = defaultStyleSpecs;

export const notesSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph, heading: createHeadingBlockSpec({ levels: [1, 2, 3, 4], allowToggleHeadings: false }), bulletListItem, numberedListItem, checkListItem, quote, codeBlock, table, image,
    toggle: toggle(), callout: callout(), equation: equation(), divider: divider(), toc: toc(), pageLink: pageLink(),
    media: media(), file: file(), bookmark: bookmark(), embed: embed(),
    columns: columns(), column: column(), columnsChildren: columnsChildren(), opaque: opaque(),
  },
  inlineContentSpecs: { text, link, branchAnchor, comment, inlineEq, mention, raw },
  styleSpecs: { bold, italic, underline, strike, code, textColor, highlight },
});

export type NotesSchema = typeof notesSchema;
