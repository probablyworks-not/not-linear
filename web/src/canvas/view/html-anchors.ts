/** Live DOM geometry only. Never persisted; the iframe owns its document and reports marks. */
type Rect = { left: number; top: number; width: number; height: number };
const frames = new Map<HTMLIFrameElement, { id: string; rect: Rect }[]>();
const listeners = new Set<() => void>();
export const htmlAnchors = {
  update(frame: HTMLIFrameElement, marks: { id: string; rect: Rect }[]): void {
    frames.set(frame, marks); listeners.forEach(fn => fn());
  },
  remove(frame: HTMLIFrameElement): void { frames.delete(frame); listeners.forEach(fn => fn()); },
  getRect(id: string): Rect | null {
    for (const [frame, marks] of frames) {
      if (!frame.isConnected || !frame.closest('.react-flow')) continue;
      const mark = marks.find(m => m.id === id);
      if (!mark) continue;
      const box = frame.getBoundingClientRect();
      const sx = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
      const sy = frame.offsetHeight ? box.height / frame.offsetHeight : 1;
      return { left: box.left + (mark.rect.left + frame.clientLeft) * sx, top: box.top + (mark.rect.top + frame.clientTop) * sy, width: mark.rect.width * sx, height: mark.rect.height * sy };
    }
    return null;
  },
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
