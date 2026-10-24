import { useState, type ReactNode } from 'react';
import { Glyph } from './Glyph';
import { GlyphPicker } from './GlyphPicker';

/** A glyph that opens the icon picker when clicked (Enter and Space too), saving the choice through `onPick`. */
export function GlyphButton({ value, cycle, index, size = 22, fallback, onPick, title = 'Set emoji', className }: {
  value?: unknown; cycle: ReadonlyArray<{ id: string; color: string }>; index: number; size?: number; fallback: ReactNode;
  onPick(token: string): void; title?: string; className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <span
        role="button" tabIndex={0} title={title} aria-label={title} data-testid="glyph-button" className={className}
        // Read the element now: inside the updater React has already reset currentTarget.
        onClick={e => { e.preventDefault(); e.stopPropagation(); const el = e.currentTarget; setAnchor(prev => (prev ? null : el)); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); const el = e.currentTarget; setAnchor(prev => (prev ? null : el)); } }}
      >
        <Glyph value={value} cycle={cycle} index={index} size={size} fallback={fallback} />
      </span>
      {anchor && <GlyphPicker anchor={anchor} onPick={onPick} onClose={() => setAnchor(null)} />}
    </>
  );
}
