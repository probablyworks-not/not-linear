// Cover photos and page icons are stored inline as data URLs, so they are shrunk first or the
// `notlinear-notes` value would balloon (port of notes.js downscaleImage).

export interface DownscaleOptions { maxW: number; maxH?: number; square?: boolean; mime?: string; quality?: number }

export function downscaleImage(file: Blob, { maxW, maxH = Infinity, square = false, mime = 'image/png', quality }: DownscaleOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('could not decode the image'));
      img.onload = () => {
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        if (square) {
          const side = Math.min(sw, sh);
          sx = (sw - side) / 2; sy = (sh - side) / 2; sw = side; sh = side;
        }
        const scale = Math.min(1, maxW / sw, maxH / sh);
        const dw = Math.max(1, Math.round(sw * scale));
        const dh = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = dw; canvas.height = dh;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no canvas')); return; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
