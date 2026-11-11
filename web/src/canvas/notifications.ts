import { create } from 'zustand';

export interface CanvasNotification {
  id: string;
  canvasId: string;
  threadId: string;
  title: string;
  kind: 'completed' | 'failed';
  createdAt: number;
  read: boolean;
}
interface NotificationState {
  items: CanvasNotification[];
  add(item: Omit<CanvasNotification, 'createdAt' | 'read'>): void;
  markRead(id: string): void;
  markAllRead(canvasId: string): void;
}
// Session-only UI state, deliberately separate from CanvasDoc and provider errors/content.
export const useCanvasNotifications = create<NotificationState>(set => ({
  items: [],
  add: item => set(s => s.items.some(n => n.id === item.id) ? s : {
    items: [{ ...item, createdAt: Date.now(), read: false }, ...s.items].slice(0, 100),
  }),
  markRead: id => set(s => ({ items: s.items.map(n => n.id === id ? { ...n, read: true } : n) })),
  markAllRead: canvasId => set(s => ({ items: s.items.map(n => n.canvasId === canvasId ? { ...n, read: true } : n) })),
}));
export const notifyCanvasRun = (item: Omit<CanvasNotification, 'createdAt' | 'read'>): void =>
  useCanvasNotifications.getState().add(item);
