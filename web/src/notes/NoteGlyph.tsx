import { FileText } from 'lucide-react';
import { Glyph } from '../ui/Glyph';

/** A page icon: a Mind Garden `icon:` token, an uploaded `img:<dataURL>` (ADR-021), or an old emoji. */
export function NoteGlyph({ value, size = 18 }: { value?: unknown; size?: number }) {
  if (typeof value === 'string' && value.startsWith('img:')) {
    return <img src={value.slice(4)} alt="" width={size} height={size} className="block rounded-[3px] object-cover" style={{ width: size, height: size }} />;
  }
  return <Glyph value={value} cycle={[]} index={0} size={size} fallback={<FileText size={size - 3} aria-hidden />} />;
}
