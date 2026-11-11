import { createDebouncedWriter } from '../../src/lib/debounced-writer';

describe('debounced writer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('coalesces typing into one write after 200ms', async () => {
    const w = createDebouncedWriter();
    const run = vi.fn();
    for (const ch of 'hello') { w.schedule('title', () => run(ch)); await vi.advanceTimersByTimeAsync(50); }
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('o');
  });

  it('keys are independent', async () => {
    const w = createDebouncedWriter();
    const a = vi.fn(); const b = vi.fn();
    w.schedule('a', a); w.schedule('b', b);
    await vi.advanceTimersByTimeAsync(200);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  });

  it('flush writes immediately and nothing fires twice', async () => {
    const w = createDebouncedWriter();
    const run = vi.fn();
    w.schedule('k', run);
    await w.flush('k');
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the write', async () => {
    const w = createDebouncedWriter();
    const run = vi.fn();
    w.schedule('k', run); w.cancel('k');
    await vi.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
  });
});
