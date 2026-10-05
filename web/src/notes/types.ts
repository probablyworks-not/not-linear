// Plain-data shapes for the Notes converter (P6a). The BN* types mirror BlockNote's
// block/inline JSON closely enough for P6b to adapt them, but import nothing from it.

export type LegacyBlock = { id?: unknown; type?: unknown; [key: string]: unknown };

export interface LegacyNote {
  id: string;
  blocks: LegacyBlock[];
  [key: string]: unknown;
}

export interface InlineStyles {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  /** `data-color` of a colour span. */
  textColor?: string;
  /** `data-c` of a `<mark>`; 'yellow' means no attribute. */
  highlight?: string;
}

export interface BNText { type: 'text'; text: string; styles: InlineStyles }
export interface BNBreak { type: 'br' }
export type BNWrapped = BNText | BNBreak;

export type BNInline =
  | BNText
  | BNBreak
  | { type: 'link'; href: string; target?: string; rel?: string; content: BNWrapped[] }
  | { type: 'branchAnchor'; bid: string; content: BNWrapped[] }
  | { type: 'comment'; cid: string; content: BNWrapped[] }
  | { type: 'inlineEq'; tex: string; inner: string; error: boolean }
  | { type: 'mention'; kind: string; id: string; text: string }
  /** Verbatim HTML for anything that cannot be mapped exactly. Never dropped. */
  | { type: 'raw'; html: string };

export interface BNTableContent { type: 'tableContent'; rows: { cells: BNInline[][] }[] }

export type BNProps = Record<string, string | number | boolean>;

export interface BNBlock {
  id: string;
  type: string;
  props: BNProps;
  content?: BNInline[] | BNTableContent;
  children: BNBlock[];
}

/** What BlockNote cannot express, keyed by BN block id. Only present when non-empty. */
export interface SidecarEntry {
  /** Known legacy fields that were absent (so `done` is not invented as false). */
  absent?: string[];
  /** Legacy fields the converter does not model. */
  extra?: Record<string, unknown>;
  /** The legacy id when the BN id had to be generated (missing or duplicate). */
  origId?: unknown;
  /** The whole legacy block, for shapes the converter will not guess at. */
  opaque?: unknown;
}

export type Sidecar = Record<string, SidecarEntry>;

export interface Converted {
  blocks: BNBlock[];
  sidecar: Sidecar;
  /** The legacy block each BN block came from (columns' synthetic children excluded). */
  originals: Record<string, unknown>;
}
