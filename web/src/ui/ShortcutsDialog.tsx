import * as Dialog from '@radix-ui/react-dialog';
import { useUiStore } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  { title: 'Chat', rows: [
    ['New chat', '⌘N'],
    ['Search', '⌘K'],
    ['Branch from selection', '⌘⇧B'],
    ['Copy last reply', '⌘⇧C'],
    ['Retry a failed reply', '⌘⇧R'],
  ] },
  { title: 'Clarifying questions', rows: [
    ['Pick an option', '1–4'],
    ['Next / finish', 'Enter'],
    ['Finish now', '⌘Enter'],
    ['Skip the questions', 'Esc'],
  ] },
  { title: 'Branch canvas', rows: [
    ['Fit to view', '⌘0'],
    ['Zoom in / out', '⌘+  /  ⌘−'],
  ] },
  { title: 'Notes', rows: [
    ['Undo', '⌘Z'],
    ['Redo', '⇧⌘Z  /  ⌘Y'],
    ['Highlight', '⌘⇧H'],
  ] },
  { title: 'Anywhere', rows: [
    ['Log feedback', '⌘⇧F'],
    ['Close the top panel', 'Esc'],
    ['This sheet', '⌘/'],
  ] },
];

/** The ⌘/ cheat sheet. Read-only: it lists the bindings, it does not own them. */
export function ShortcutsDialog() {
  const open = useUiStore(s => s.shortcutsOpen);
  const setOpen = useUiStore(s => s.setShortcutsOpen);
  const close = (): void => setOpen(false);
  useEscLayer('shortcuts', ESC_PRIORITY.shortcutsSheet, open, close);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-scrim" />
        <Dialog.Content
          aria-label="Keyboard shortcuts" aria-describedby={undefined}
          onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-[14vh] z-[201] w-[min(480px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-rule bg-bg shadow-lg"
          data-testid="shortcuts-dialog"
        >
          <Dialog.Title className="m-0 border-b border-rule px-[18px] py-3 text-base font-semibold text-text">Keyboard shortcuts</Dialog.Title>
          <div className="max-h-[60vh] overflow-y-auto px-[18px] py-3">
            {GROUPS.map(g => (
              <section key={g.title} className="mb-3 last:mb-0">
                <h3 className="m-0 mb-1 font-mono text-xs uppercase tracking-wide text-text-3">{g.title}</h3>
                {g.rows.map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between py-1 text-sm text-text-2">
                    <span>{label}</span>
                    <kbd className="rounded-sm border border-rule-2 bg-bg-2 px-1.5 py-0.5 font-mono text-xs text-text">{keys}</kbd>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
