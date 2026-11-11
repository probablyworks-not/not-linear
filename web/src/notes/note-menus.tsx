import {
  BasicTextStyleButton, CreateLinkButton, DragHandleMenu, FormattingToolbar, RemoveBlockItem, SideMenu, DragHandleButton,
  AddBlockButton, getDefaultReactSlashMenuItems, useBlockNoteEditor, useComponentsContext, type BlockTypeSelectItem,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { ChevronDown, GitBranch, Replace, ChevronRight, Code2, Heading1, Heading2, Heading3, Heading4, Lightbulb as CalloutIcon, List, ListChecks, ListOrdered, Pilcrow, Quote, Sigma } from 'lucide-react';
import katex from 'katex';
import { useAppStore } from '../state/app-store';
import { visibleThreads, MAIN_THREAD_ID } from '../db/thread-ops';
import { useNotesStore } from './notes-store';
import { useStartBranch } from './NoteContext';

// The editor's menus. Anything a menu can do has to survive the converter, so block-level colours,
// text alignment and cell merging are deliberately not offered: they have nowhere to be saved.

interface Blk { type: string; props?: Record<string, unknown>; children?: Blk[]; content?: unknown }
interface Cursor { block: { id: string; type: string; content?: unknown } }
interface MenuEditor {
  getTextCursorPosition(): Cursor;
  getBlock(id: string): { id: string; children?: { id: string; children?: unknown[] }[] } | undefined;
  updateBlock(block: unknown, update: Blk): unknown;
  insertBlocks(blocks: Blk[], reference: unknown, placement: 'before' | 'after'): { id: string }[];
  setTextCursorPosition(block: unknown, placement?: 'start' | 'end'): void;
  insertInlineContent(content: unknown[]): void;
  getSelectedText(): string;
  getActiveStyles(): Record<string, unknown>;
  addStyles(styles: Record<string, string>): void;
  removeStyles(styles: Record<string, string>): void;
}

const isEmptyParagraph = (b: Cursor['block']): boolean =>
  b.type === 'paragraph' && (!Array.isArray(b.content) || (b.content as { text?: string }[]).every(n => !n.text));

/** Turns an empty line into the block, or adds it after the current one. */
export function insertBlock(editor: MenuEditor, block: Blk): void {
  const cur = editor.getTextCursorPosition().block;
  let target: string;
  if (isEmptyParagraph(cur)) { editor.updateBlock(cur, block); target = cur.id; }
  else {
    const [made] = editor.insertBlocks([block], cur, 'after');
    if (!made) return;
    target = made.id;
  }
  // A container (columns) has no text of its own: put the cursor in its first nested line.
  if (block.children?.length) {
    let node = editor.getBlock(target);
    while (node?.children?.length) node = node.children[0] as typeof node;
    if (node && node.id !== target) { editor.setTextCursorPosition(node, 'end'); return; }
  }
  if (target !== cur.id) editor.setTextCursorPosition(editor.getBlock(target), 'end');
}

const col = (): Blk => ({ type: 'column', children: [{ type: 'paragraph' }] });

interface Entry { title: string; subtext: string; aliases: string[]; group: string; block: Blk }

const CUSTOM: Entry[] = [
  { title: 'Heading 4', subtext: 'Small section heading', aliases: ['h4', 'heading4'], group: 'Basic blocks', block: { type: 'heading', props: { level: 4 } } },
  { title: 'Toggle list', subtext: 'Content you can fold away', aliases: ['toggle', 'collapse'], group: 'Basic blocks', block: { type: 'toggle' } },
  { title: 'Toggle heading 1', subtext: 'Large heading that folds', aliases: ['toggle h1'], group: 'Basic blocks', block: { type: 'toggle', props: { headingLevel: 1 } } },
  { title: 'Toggle heading 2', subtext: 'Medium heading that folds', aliases: ['toggle h2'], group: 'Basic blocks', block: { type: 'toggle', props: { headingLevel: 2 } } },
  { title: 'Toggle heading 3', subtext: 'Small heading that folds', aliases: ['toggle h3'], group: 'Basic blocks', block: { type: 'toggle', props: { headingLevel: 3 } } },
  { title: 'Callout', subtext: 'Make a point stand out', aliases: ['callout', 'note', 'info'], group: 'Basic blocks', block: { type: 'callout' } },
  { title: 'Divider', subtext: 'A horizontal rule', aliases: ['divider', 'hr', 'rule', '---'], group: 'Basic blocks', block: { type: 'divider' } },
  { title: 'Page', subtext: 'A link to a new subpage', aliases: ['page', 'subpage'], group: 'Basic blocks', block: { type: 'pageLink' } },
  { title: 'Video or audio', subtext: 'YouTube, Vimeo or a file link', aliases: ['media', 'video', 'audio', 'youtube'], group: 'Media & content', block: { type: 'media' } },
  { title: 'File', subtext: 'Attach a file', aliases: ['file', 'attachment'], group: 'Media & content', block: { type: 'file' } },
  { title: 'Bookmark', subtext: 'A link with a preview', aliases: ['bookmark', 'link'], group: 'Media & content', block: { type: 'bookmark' } },
  { title: 'Embed', subtext: 'Figma, CodePen or Google Maps', aliases: ['embed', 'figma', 'codepen', 'maps'], group: 'Media & content', block: { type: 'embed' } },
  { title: '2 columns', subtext: 'Two side-by-side columns', aliases: ['columns', '2col'], group: 'Advanced', block: { type: 'columns', children: [col(), col()] } },
  { title: '3 columns', subtext: 'Three side-by-side columns', aliases: ['columns', '3col'], group: 'Advanced', block: { type: 'columns', children: [col(), col(), col()] } },
  { title: 'Block equation', subtext: 'LaTeX, rendered', aliases: ['equation', 'latex', 'math'], group: 'Advanced', block: { type: 'equation' } },
  { title: 'Table of contents', subtext: 'Built from your headings', aliases: ['toc', 'contents'], group: 'Advanced', block: { type: 'toc' } },
];

/** The built-ins legacy had, in BlockNote's own wording. The rest (video, audio, emoji, page break) are left out. */
const KEEP_DEFAULT = new Set(['Paragraph', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote', 'Numbered List', 'Bullet List', 'Check List', 'Code Block', 'Table', 'Image']);

export function slashItems(editor: unknown, query: string): Promise<DefaultReactSuggestionItem[]> {
  const e = editor as MenuEditor;
  const defaults = getDefaultReactSlashMenuItems(editor as never)
    .filter(i => KEEP_DEFAULT.has(i.title))
    .map(i => ({ ...i, group: i.group === 'Media' ? 'Media & content' : 'Basic blocks' }));
  const custom: DefaultReactSuggestionItem[] = CUSTOM.map(c => ({
    title: c.title, subtext: c.subtext, aliases: c.aliases, group: c.group, onItemClick: () => insertBlock(e, c.block),
  }));
  const q = query.trim().toLowerCase();
  const all = [...defaults, ...custom];
  return Promise.resolve(q ? all.filter(i => i.title.toLowerCase().includes(q) || i.aliases?.some(a => a.toLowerCase().includes(q))) : all);
}

export function mentionItems(editor: unknown, query: string): Promise<DefaultReactSuggestionItem[]> {
  const e = editor as MenuEditor;
  const q = query.trim().toLowerCase();
  const titleOf = (t: unknown) => (typeof t === 'string' && t ? t : 'Untitled');
  const insert = (kind: 'note' | 'chat', id: string, text: string) => e.insertInlineContent([{ type: 'mention', props: { kind, id, text } }, ' ']);

  const notes = useNotesStore.getState().notes
    .filter(n => titleOf(n.title).toLowerCase().includes(q)).slice(0, 8)
    .map(n => ({ title: titleOf(n.title), group: 'Notes', onItemClick: () => insert('note', n.id, `\u{1F4C4} ${titleOf(n.title)}`) }));

  const app = useAppStore.getState();
  const chats = visibleThreads({
    threads: app.threadState, dynamic: app.dynamicThreads, deletedThreads: app.deletedThreadIds,
    current: MAIN_THREAD_ID, chatCount: 1, projects: {}, projectCount: 1, prefs: {},
  })
    .filter(t => t.title.toLowerCase().includes(q)).slice(0, 8)
    .map(t => ({ title: t.title, group: 'Chats', onItemClick: () => insert('chat', t.id, `\u{1F4AC} ${t.title}`) }));

  return Promise.resolve([...notes, ...chats]);
}

// ---- formatting toolbar -------------------------------------------------------------------------

const TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'purple'];
const HIGHLIGHTS = ['yellow', 'blue', 'green', 'pink', 'gray'];

const TEXT_VAR: Record<string, string> = { red: '--tx-red', orange: '--tx-orange', green: '--tx-green', blue: '--tx-blue', purple: '--tx-purple' };
const HL_VAR: Record<string, string> = { yellow: '--hl-yellow', blue: '--hl-blue', green: '--hl-green', pink: '--hl-pink', gray: '--hl-gray' };

let lastHighlight = 'yellow';

/** ⌘⇧H: apply the highlight last picked from the menu (yellow until one is), or clear it if the selection already has it. */
export function applyLastHighlight(editor: unknown): void {
  const e = editor as MenuEditor;
  const active = e.getActiveStyles().highlight;
  if (active === lastHighlight) e.removeStyles({ highlight: active });
  else e.addStyles({ highlight: lastHighlight });
}

function Swatch({ cssVar, text }: { cssVar: string; text?: boolean }) {
  return text
    ? <span aria-hidden className="grid h-4 w-4 place-items-center text-[13px] font-semibold" style={{ color: `var(${cssVar})` }}>A</span>
    : <span aria-hidden className="h-4 w-4 rounded" style={{ background: `var(${cssVar})` }} />;
}

/** Text colour and highlight in one menu, as the classic toolbar's "A" picker. */
function ColourMenu() {
  const editor = useBlockNoteEditor() as unknown as MenuEditor;
  const C = useComponentsContext();
  if (!C) return null;
  const active = editor.getActiveStyles();
  const text = typeof active.textColor === 'string' ? active.textColor : null;
  const hl = typeof active.highlight === 'string' ? active.highlight : null;
  return (
    <C.Generic.Menu.Root portalElement={null}>
      <C.Generic.Menu.Trigger>
        <C.FormattingToolbar.Button className="bn-button" label="Colour" mainTooltip="Text colour and highlight" isSelected={!!(text || hl)}>
          <span className="inline-flex items-center gap-0.5">
            <span className="text-[14px] font-semibold" style={{ color: text ? `var(${TEXT_VAR[text] ?? '--tx-blue'})` : 'var(--tx-blue)', background: hl ? `var(${HL_VAR[hl] ?? '--hl-yellow'})` : undefined }}>A</span>
            <ChevronDown size={11} aria-hidden />
          </span>
        </C.FormattingToolbar.Button>
      </C.Generic.Menu.Trigger>
      <C.Generic.Menu.Dropdown className="bn-menu-dropdown">
        <C.Generic.Menu.Label>Text colour</C.Generic.Menu.Label>
        <C.Generic.Menu.Item onClick={() => { if (text) editor.removeStyles({ textColor: text }); }} checked={!text}>default</C.Generic.Menu.Item>
        {TEXT_COLORS.map(v => (
          <C.Generic.Menu.Item key={v} icon={<Swatch cssVar={TEXT_VAR[v]!} text />} onClick={() => editor.addStyles({ textColor: v })} checked={text === v}>{v}</C.Generic.Menu.Item>
        ))}
        <C.Generic.Menu.Divider />
        <C.Generic.Menu.Label>Highlight</C.Generic.Menu.Label>
        <C.Generic.Menu.Item onClick={() => { if (hl) editor.removeStyles({ highlight: hl }); }} checked={!hl}>none</C.Generic.Menu.Item>
        {HIGHLIGHTS.map(v => (
          <C.Generic.Menu.Item key={v} icon={<Swatch cssVar={HL_VAR[v]!} />} onClick={() => { lastHighlight = v; editor.addStyles({ highlight: v }); }} checked={hl === v}>{`${v} highlight`}</C.Generic.Menu.Item>
        ))}
      </C.Generic.Menu.Dropdown>
    </C.Generic.Menu.Root>
  );
}

function EquationButton() {
  const editor = useBlockNoteEditor() as unknown as MenuEditor;
  const C = useComponentsContext();
  if (!C) return null;
  return (
    <C.FormattingToolbar.Button
      className="bn-button" label="Equation" mainTooltip="Turn the selection into an inline equation"
      onClick={() => {
        const source = editor.getSelectedText();
        if (!source.trim()) return;
        let html = source; let error = false;
        try { html = katex.renderToString(source, { throwOnError: true, strict: 'ignore' }); } catch { error = true; }
        editor.insertInlineContent([{ type: 'inlineEq', props: { tex: source, inner: html, error } }]);
      }}
    >
      <Sigma size={14} />
    </C.FormattingToolbar.Button>
  );
}

function BranchButton() {
  const start = useStartBranch();
  const C = useComponentsContext();
  if (!C || !start) return null;
  return (
    <C.FormattingToolbar.Button className="bn-button" label="Branch" mainTooltip="Ask AI about the selection" onClick={start}>
      <GitBranch size={14} />
    </C.FormattingToolbar.Button>
  );
}

const TURN_INTO: BlockTypeSelectItem[] = [
  { name: 'Paragraph', type: 'paragraph', icon: Pilcrow },
  { name: 'Heading 1', type: 'heading', props: { level: 1 }, icon: Heading1 },
  { name: 'Heading 2', type: 'heading', props: { level: 2 }, icon: Heading2 },
  { name: 'Heading 3', type: 'heading', props: { level: 3 }, icon: Heading3 },
  { name: 'Heading 4', type: 'heading', props: { level: 4 }, icon: Heading4 },
  { name: 'Bullet list', type: 'bulletListItem', icon: List },
  { name: 'Numbered list', type: 'numberedListItem', icon: ListOrdered },
  { name: 'To-do list', type: 'checkListItem', icon: ListChecks },
  { name: 'Toggle', type: 'toggle', icon: ChevronRight },
  { name: 'Quote', type: 'quote', icon: Quote },
  { name: 'Callout', type: 'callout', icon: CalloutIcon },
  { name: 'Code', type: 'codeBlock', icon: Code2 },
];

function TurnIntoMenu() {
  const editor = useBlockNoteEditor() as unknown as MenuEditor;
  const C = useComponentsContext();
  if (!C) return null;
  return (
    <C.Generic.Menu.Root portalElement={null}>
      <C.Generic.Menu.Trigger>
        <C.FormattingToolbar.Button className="bn-button" label="Turn into" mainTooltip="Turn this block into…">
          <span className="inline-flex items-center gap-1"><Replace size={14} aria-hidden /><span className="text-[13px]">Turn</span></span>
        </C.FormattingToolbar.Button>
      </C.Generic.Menu.Trigger>
      <C.Generic.Menu.Dropdown className="bn-menu-dropdown">
        {TURN_INTO.map(item => {
          const Icon = item.icon;
          return (
            <C.Generic.Menu.Item
              key={item.name} icon={<Icon size={14} />}
              onClick={() => editor.updateBlock(editor.getTextCursorPosition().block, { type: item.type, props: item.props } as never)}
            >
              {item.name}
            </C.Generic.Menu.Item>
          );
        })}
      </C.Generic.Menu.Dropdown>
    </C.Generic.Menu.Root>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px flex-none self-center bg-rule-2" />;

export function NoteToolbar({ extra }: { extra?: React.ReactNode }) {
  return (
    <FormattingToolbar>
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="underline" key="underline" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />
      <EquationButton key="equation" />
      <Sep key="s1" />
      <ColourMenu key="colour" />
      <Sep key="s2" />
      <TurnIntoMenu key="turn" />
      <Sep key="s3" />
      <CreateLinkButton key="link" />
      <BranchButton key="branch" />
      {extra}
    </FormattingToolbar>
  );
}

// ---- side menu ---------------------------------------------------------------------------------------

export function NoteSideMenu(props: React.ComponentProps<typeof SideMenu>) {
  return (
    <SideMenu {...props}>
      <AddBlockButton />
      <DragHandleButton {...props} dragHandleMenu={() => <DragHandleMenu><RemoveBlockItem>Delete</RemoveBlockItem></DragHandleMenu>} />
    </SideMenu>
  );
}

