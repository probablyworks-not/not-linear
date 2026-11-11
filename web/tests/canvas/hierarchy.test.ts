import { describe, expect, it } from 'vitest';
import { emptyDoc, type Relation } from '../../src/canvas/types';
import { canvasHierarchy } from '../../src/canvas/view/hierarchy';

function fixture() {
  const d = emptyDoc({ id: 'cv', title: 'Hierarchy', projectId: null, rev: 1, createdAt: 0, updatedAt: 0, counts: { threads: 0, messages: 0, outputs: 0 } });
  d.threads = ['root', 'branch', 'child', 'other', 'synthesis'].map((id, i) => ({ id, title: id, kind: id === 'root' || id === 'other' ? 'root' : id === 'synthesis' ? 'synthesis' : 'branch', createdAt: i, updatedAt: i, rev: 1 }));
  const edge = (from: string, to: string, kind: Relation['kind'] = 'branch'): Relation => ({ id: `${from}:${to}`, fromThreadId: from, toThreadId: to, kind, createdAt: 1 });
  d.relations = [edge('root', 'branch'), edge('branch', 'child'), edge('child', 'synthesis', 'synthesis'), edge('other', 'synthesis', 'synthesis'), edge('child', 'root', 'reference')];
  return { d, edge };
}

describe('Canvas hierarchy display forest', () => {
  it('nests descendants under their actual parent, keeps independent roots and every synthesis source', () => {
    const { d } = fixture();
    const original = JSON.stringify(d);
    const tree = canvasHierarchy(d);
    expect(tree.roots.map(t => t.id)).toEqual(['root', 'other']);
    expect(tree.children.get('root')?.map(t => t.id)).toEqual(['branch']);
    expect(tree.children.get('branch')?.map(t => t.id)).toEqual(['child']);
    expect(tree.sources.get('synthesis')).toEqual(['child', 'other']);
    expect(tree.parents.get('root')).toBeUndefined();
    expect(JSON.stringify(d)).toBe(original);
  });
  it('keeps orphan branches reachable and breaks malformed cycles without losing cards', () => {
    const { d, edge } = fixture();
    d.relations = [edge('missing', 'branch'), edge('branch', 'child'), edge('child', 'branch'), edge('synthesis', 'synthesis')];
    const tree = canvasHierarchy(d);
    const visited: string[] = [];
    const walk = (id: string) => { expect(visited).not.toContain(id); visited.push(id); tree.children.get(id)?.forEach(t => walk(t.id)); };
    tree.roots.forEach(t => walk(t.id));
    expect(visited.sort()).toEqual(d.threads.map(t => t.id).sort());
  });
});
