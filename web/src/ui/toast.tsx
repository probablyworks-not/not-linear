import { Toaster as Sonner, toast as sonnerToast } from 'sonner';

// Legacy toast (core/ui.js:25) is a single auto-dismissing line, 1800ms, and a
// new toast replaces the old one. Sonner stacks by default; `visibleToasts={1}`
// plus dismissing the previous id keeps the "replace" behaviour.
const DURATION_MS = 1800;
let last: string | number | undefined;

export function toast(message: string): void {
  if (last !== undefined) sonnerToast.dismiss(last);
  last = sonnerToast(message, { duration: DURATION_MS });
}

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      visibleToasts={1}
      offset={90}
      // Colours come from tokens via the CSS variables Sonner exposes, so the
      // toast follows the active theme like everything else.
      style={{
        '--normal-bg': 'var(--surface-2)',
        '--normal-border': 'var(--rule-2)',
        '--normal-text': 'var(--text)',
        fontSize: '13px',
      } as React.CSSProperties}
    />
  );
}
