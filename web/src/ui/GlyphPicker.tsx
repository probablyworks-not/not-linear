import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Droplet, DropletOff } from 'lucide-react';
import { ICON_COLORS, renderIconSvg, useMindGarden } from '../lib/mind-garden';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

/**
 * The icon picker (core/emoji.js openEmojiPicker): a searchable grid of Mind Garden icons under
 * the thing being decorated, with a colour swatch. Picking returns an `icon:<id>[:<hex>]` token.
 * Enter picks the first match; Esc, a click outside, or picking closes it. Styled by the classes
 * legacy already ships (styles/emoji-picker.css, imported once in app.css).
 */
export function GlyphPicker({ anchor, onPick, onClose }: { anchor: HTMLElement; onPick(token: string): void; onClose(): void }) {
  const entries = useMindGarden(s => s.entries);
  const status = useMindGarden(s => s.status);
  const load = useMindGarden(s => s.load);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { void load(); }, [load]);
  useEscLayer('glyphPicker', ESC_PRIORITY.glyphPicker, true, onClose);

  // Placed under the anchor and kept on screen (legacy: 300 wide, up to 380 tall).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    el.style.width = '300px';
    el.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 380 - 8)}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300 - 8))}px`;
  }, [anchor]);

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    // After this click has finished, so the click that opened the picker does not close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', down), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', down); };
  }, [anchor, onClose]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter(e => e.keywords.includes(q)) : entries;
  }, [entries, query]);
  const token = (id: string): string => (color ? `icon:${id}:${color.replace('#', '')}` : `icon:${id}`);
  const pick = (id: string): void => { onPick(token(id)); onClose(); };

  return (
    <div ref={ref} className="cp-pop cp-emoji-pop mg-only" role="dialog" aria-label="Choose an icon" data-testid="glyph-picker">
      <div className="mg-toolbar">
        <input
          autoFocus className="cp-emoji-search" placeholder="search icons…" autoComplete="off" aria-label="Search icons" value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && list[0]) pick(list[0].id); }}
        />
        <button
          type="button" title="icon color" aria-label="Icon color" className={`mg-color-swatch${color ? '' : ' default'}`}
          onClick={e => { e.stopPropagation(); setPaletteOpen(o => !o); }}
        >
          {color ? <span className="mg-color-fill" style={{ background: color }} /> : <Droplet size={16} />}
        </button>
      </div>
      {paletteOpen && (
        <div className="mg-color-pop" data-testid="glyph-palette">
          {ICON_COLORS.map(c => (
            <button
              key={c.name} type="button" title={c.name} aria-label={`Color ${c.name}`}
              className={`mg-color-opt${c.hex ? '' : ' default'}`} style={c.hex ? { background: c.hex } : undefined}
              onClick={() => { setColor(c.hex); setPaletteOpen(false); }}
            >
              {!c.hex && <DropletOff size={14} />}
            </button>
          ))}
        </div>
      )}
      <div className="cp-emoji-grid mg-grid">
        {status === 'failed' ? <div className="cp-emoji-empty">mind garden failed to load</div>
          : status !== 'ready' ? <div className="cp-emoji-empty">loading…</div>
          : list.length === 0 ? <div className="cp-emoji-empty">no matches</div>
          : list.map(e => (
            <button
              key={e.id} type="button" className="cp-emoji-opt mg-opt" data-icon={e.id} title={e.name} aria-label={e.name}
              onClick={() => pick(e.id)} dangerouslySetInnerHTML={{ __html: renderIconSvg(entries, e.id, { size: 30, color }) }}
            />
          ))}
      </div>
    </div>
  );
}
