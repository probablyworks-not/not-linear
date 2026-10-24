import { useEffect, type ReactNode } from 'react';
import { cycleIcon, parseIconToken, renderIconSvg, useMindGarden } from '../lib/mind-garden';

type Cycle = ReadonlyArray<{ id: string; color: string }>;

/**
 * The little picture beside a thread, project or title (app.js glyphHTML / cycleGlyphHTML).
 * A chosen `icon:` token draws that icon; any other stored text is shown as it is (an emoji from
 * an older version); with nothing chosen it falls back to the default for this position in the
 * list, and to `fallback` until the icon sheet has loaded or if an id is not in it.
 */
export function Glyph({ value, cycle, index, size = 22, fallback }: {
  value?: unknown; cycle: Cycle; index: number; size?: number; fallback: ReactNode;
}) {
  const entries = useMindGarden(s => s.entries);
  const load = useMindGarden(s => s.load);
  useEffect(() => { void load(); }, [load]);

  const token = typeof value === 'string' && value ? value : '';
  const parsed = parseIconToken(token);
  if (token && !parsed) return <span>{token}</span>;
  const pick = parsed ?? (cycle.length ? cycleIcon(cycle, index) : null);
  if (!pick) return <>{fallback}</>;
  const svg = renderIconSvg(entries, pick.id, { size, color: pick.color });
  return svg ? <span className="mg-glyph" dangerouslySetInnerHTML={{ __html: svg }} /> : <>{fallback}</>;
}
