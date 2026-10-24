import { useExtrasStore } from '../../src/projects/extras/extras-store';
import { setProjectSources } from '../../src/projects/extras/sources';

beforeEach(() => { useExtrasStore.setState({ artifacts: {}, memory: {}, loaded: {}, error: {} }); setProjectSources({}); });

describe('project extras seam', () => {
  it('defaults to empty sources, marked loaded', async () => {
    await useExtrasStore.getState().load('p1');
    const s = useExtrasStore.getState();
    expect(s.artifacts.p1).toEqual([]);
    expect(s.memory.p1).toEqual([]);
    expect(s.loaded.p1).toBe(true);
    expect(s.error.p1).toBe('');
  });

  it('shows whatever a real source returns, per project', async () => {
    const art = { id: 'a1', projectId: 'p1', title: 'IA diagram', type: 'SVG' as const, version: 3, chatId: 'c', updatedAt: 1 };
    setProjectSources({ artifacts: { list: async pid => (pid === 'p1' ? [art] : []) } });
    await useExtrasStore.getState().load('p1');
    await useExtrasStore.getState().load('p2');
    expect(useExtrasStore.getState().artifacts.p1).toEqual([art]);
    expect(useExtrasStore.getState().artifacts.p2).toEqual([]);
  });

  it('surfaces a failing source instead of pretending the project is empty', async () => {
    setProjectSources({ memory: { list: async () => { throw new Error('backend down'); } } });
    await useExtrasStore.getState().load('p1');
    expect(useExtrasStore.getState().error.p1).toBe('backend down');
    expect(useExtrasStore.getState().loaded.p1).toBe(true);
  });

  it('removeMemory calls the source, then drops the item', async () => {
    const remove = vi.fn(async () => {});
    const item = (id: string) => ({ id, projectId: 'p1', text: id, createdAt: 1 });
    setProjectSources({ memory: { list: async () => [item('m1'), item('m2')], remove } });
    await useExtrasStore.getState().load('p1');
    await useExtrasStore.getState().removeMemory('p1', 'm1');
    expect(remove).toHaveBeenCalledWith('p1', 'm1');
    expect(useExtrasStore.getState().memory.p1!.map(m => m.id)).toEqual(['m2']);
  });
});
