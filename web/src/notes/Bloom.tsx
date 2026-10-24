import { useEffect } from 'react';
import { parseIconToken, renderIconSvg, useMindGarden } from '../lib/mind-garden';
import { bloomFor, type BentoShape } from './bento';
import { NoteGlyph } from './NoteGlyph';

/**
 * A giant, faint copy of an item's icon bleeding off a bento card's corner. Skipped for uploaded photos:
 * a huge faint raster reads as a bug. `fallbackId` is a Mind Garden icon id drawn when `icon` is unset.
 */
export function Bloom({ id, icon, shape, fallbackId }: { id: string; icon: unknown; shape: BentoShape; fallbackId?: string }) {
  const entries = useMindGarden(s => s.entries);
  const load = useMindGarden(s => s.load);
  useEffect(() => { void load(); }, [load]);
  if (typeof icon === 'string' && icon.startsWith('img:')) return null;
  const { size, rotate } = bloomFor(id, shape);

  // An icon the user coloured keeps its colour; otherwise it takes the card's tint (legacy bentoIconHTML).
  const parsed = typeof icon === 'string' && icon.startsWith('icon:') ? parseIconToken(icon) : null;
  const pick = parsed ?? (!icon && fallbackId ? { id: fallbackId, color: '' } : null);
  const svg = pick ? renderIconSvg(entries, pick.id, { size, color: pick.color || 'var(--tfg)' }) : '';
  return (
    <span className="nl-bloom" aria-hidden style={{ transform: `rotate(${rotate}deg)` }}>
      {svg
        ? <span dangerouslySetInnerHTML={{ __html: svg }} />
        : <span style={{ fontSize: size, lineHeight: 1 }}><NoteGlyph value={icon} size={size} /></span>}
    </span>
  );
}
