import { useUiStore } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

/** A picture from a message, full size over a dimmed page (app.js openImagePreview). Click or Esc to dismiss. */
export function ImagePreview() {
  const image = useUiStore(s => s.imagePreview);
  const close = useUiStore(s => s.setImagePreview);
  useEscLayer('imagePreview', ESC_PRIORITY.imagePreview, !!image, () => close(null));
  if (!image) return null;
  return (
    <div role="dialog" aria-label="Image preview" className="fixed inset-0 z-[9999] flex cursor-zoom-out items-center justify-center bg-scrim" onClick={() => close(null)} data-testid="image-preview">
      <img src={image.src} alt={image.name} className="max-h-[88vh] max-w-[90vw] rounded-md object-contain shadow-lg" />
    </div>
  );
}
