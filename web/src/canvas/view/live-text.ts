// Streamed text lives outside the canvas document on purpose.
//
// A token arriving must update one card and nothing else. If the text went into the document, every
// token would make a new `nodes` array and re-render the whole scene; the C0 spike measured the
// difference — the streamed subtree re-rendered 91 times while the scene stayed at 68 and a
// neighbouring card at 3. Only the card being streamed into subscribes here.
//
// This is a cache, never the record. The document still gets the text on a debounce, so a reload
// mid-stream finds the partial answer.

const text = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

const notify = (id: string): void => { listeners.get(id)?.forEach(fn => fn()); };

export const liveText = {
  subscribeTo(id: string) {
    return (fn: () => void): (() => void) => {
      let set = listeners.get(id);
      if (!set) { set = new Set(); listeners.set(id, set); }
      set.add(fn);
      return () => { set.delete(fn); if (set.size === 0) listeners.delete(id); };
    };
  },
  getOf(id: string) {
    return (): string | undefined => text.get(id);
  },
  set(id: string, value: string): void { text.set(id, value); notify(id); },
  clear(id: string): void { text.delete(id); notify(id); },
  clearAll(): void {
    const ids = [...text.keys()];
    text.clear();
    for (const id of ids) notify(id);
  },
};
