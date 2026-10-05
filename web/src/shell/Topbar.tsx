import { useEffect, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { PanelLeftOpen } from 'lucide-react';
import { useUiStore } from '../state/ui-store';

/** Sticky bar with the sidebar toggle and breadcrumb; gains a hairline once content scrolls under it. */
export function Topbar({ trail }: { trail: ReactNode }) {
  const open = useUiStore(s => s.sidebarOpen);
  const setOpen = useUiStore(s => s.setSidebarOpen);
  const [scrolled, setScrolled] = useState(false);

  // Syncing with an external system (window scroll), which is what an effect is for.
  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      data-topbar
      className={clsx(
        'sticky top-0 z-20 flex items-center gap-3 border-b bg-bg px-7 py-3.5 transition-colors duration-150',
        scrolled ? 'border-rule shadow-md' : 'border-transparent',
      )}
    >
      <button
        type="button" title="Open left pane" aria-label="Open left pane" aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text"
      >
        <PanelLeftOpen size={15} />
      </button>
      <div className="min-w-0 flex-1 truncate text-sm text-text-2" data-testid="crumb-trail">{trail}</div>
    </div>
  );
}
