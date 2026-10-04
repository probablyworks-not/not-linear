// The pen-annotation maths of the screenshot preview (core/feedback.js:244-266),
// kept free of React so it can be tested without a browser canvas.

export interface Pt { x: number; y: number }
export type Stroke = Pt[];

/**
 * Viewport coordinates -> canvas pixel coordinates, scaling for any difference
 * between the canvas's natural resolution (the image's pixels) and its displayed
 * CSS size. A zero-size rect (display:none) maps to the origin rather than NaN.
 */
export function canvasPoint(
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
  clientX: number,
  clientY: number,
): Pt {
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}

/** Line width scales with the image so annotations stay visible on a 4K screenshot. */
export function strokeWidth(canvasWidth: number): number {
  return Math.max(3, canvasWidth / 500);
}

/** The surface a stroke is painted on. Matches the parts of CanvasRenderingContext2D used. */
export interface Ctx2D {
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: CanvasImageSource, x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
}

/** Repaint the screenshot, then every stroke on top of it. */
export function redraw(ctx: Ctx2D, canvas: { width: number; height: number }, img: CanvasImageSource, strokes: readonly Stroke[], color: string): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth(canvas.width);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.beginPath();
    s.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.stroke();
  }
}

/**
 * Canvases cannot resolve var(--x), so the annotation colour is read from the
 * computed style of the token at draw time (and follows the theme if it ever varies).
 */
export function annotationColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--annotate').trim() || 'red';
}
