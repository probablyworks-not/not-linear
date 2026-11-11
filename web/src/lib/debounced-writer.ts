/**
 * "Persistence — debounce, don't blast" (CLAUDE.md). Typed text coalesces for
 * 200ms; anything that is a discrete event (drag end, status change) calls
 * `flush` or `now` and writes immediately.
 *
 * Keyed, so edits to different things don't cancel each other.
 */
export const TYPING_DEBOUNCE_MS = 200;

export interface DebouncedWriter<K extends string = string> {
  /** Schedule `run` for `key`, replacing any pending run for that key. */
  schedule(key: K, run: () => Promise<void> | void): void;
  /** Run `key`'s pending write now, if any. */
  flush(key: K): Promise<void>;
  flushAll(): Promise<void>;
  /** Cancel without running (e.g. the thing being edited was deleted). */
  cancel(key: K): void;
}

export function createDebouncedWriter<K extends string = string>(ms = TYPING_DEBOUNCE_MS): DebouncedWriter<K> {
  const pending = new Map<K, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> | void }>();

  const fire = async (key: K): Promise<void> => {
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
    await entry.run();
  };

  return {
    schedule(key, run) {
      const prev = pending.get(key);
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => { void fire(key); }, ms);
      pending.set(key, { timer, run });
    },
    flush: fire,
    async flushAll() { await Promise.all([...pending.keys()].map(fire)); },
    cancel(key) {
      const prev = pending.get(key);
      if (prev) clearTimeout(prev.timer);
      pending.delete(key);
    },
  };
}
