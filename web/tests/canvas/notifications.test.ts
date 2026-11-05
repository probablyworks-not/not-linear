import { beforeEach, describe, expect, it } from 'vitest';
import { notifyCanvasRun, useCanvasNotifications } from '../../src/canvas/notifications';

beforeEach(() => useCanvasNotifications.setState({ items: [] }));
const event = { id: 'run-a', canvasId: 'canvas-a', threadId: 'branch-a', title: 'Explain this', kind: 'completed' as const };
describe('Canvas activity history', () => {
  it('keeps the originating Canvas and thread, and publishes each run once', () => {
    notifyCanvasRun(event);
    useCanvasNotifications.getState().markRead(event.id);
    notifyCanvasRun(event);
    expect(useCanvasNotifications.getState().items).toEqual([expect.objectContaining({ ...event, read: true })]);
  });
  it('marks only the requested Canvas read and retains error history', () => {
    notifyCanvasRun(event);
    notifyCanvasRun({ ...event, id: 'run-b', canvasId: 'canvas-b', kind: 'failed' });
    useCanvasNotifications.getState().markAllRead('canvas-a');
    expect(useCanvasNotifications.getState().items.map(n => [n.canvasId, n.kind, n.read])).toEqual([
      ['canvas-b', 'failed', false], ['canvas-a', 'completed', true],
    ]);
  });
  it('bounds session memory and keeps the newest activity', () => {
    for (let i = 0; i < 105; i++) notifyCanvasRun({ ...event, id: `run-${i}` });
    const items = useCanvasNotifications.getState().items;
    expect(items).toHaveLength(100);
    expect(items[0]?.id).toBe('run-104');
    expect(items[99]?.id).toBe('run-5');
  });
});
