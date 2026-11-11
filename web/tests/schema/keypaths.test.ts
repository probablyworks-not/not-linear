import { describe, it, expect } from 'vitest';
import { keyPaths, schemaPaths } from '../../src/db/keypaths';

describe('keyPaths', () => {
  it('records a dotted path and type for every leaf', () => {
    expect(keyPaths({ a: 1, b: { c: 'x' } })).toEqual([
      'a:number', 'b.c:string', 'b:object',
    ]);
  });

  it('collapses array elements to one [] segment regardless of length', () => {
    const one = keyPaths({ xs: [{ id: 'a' }] });
    const many = keyPaths({ xs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(one).toEqual(many);
    expect(one).toContain('xs[].id:string');
  });

  it('distinguishes null from object, so a nulled field is visible', () => {
    expect(keyPaths({ a: null })).toEqual(['a:null']);
    expect(keyPaths({ a: {} })).toEqual(['a:object']);
  });
});

describe('schemaPaths', () => {
  it('collapses id-keyed maps so adding a thread does not churn the golden', () => {
    const a = schemaPaths({ threads: { 'chat-1': { title: 'x' } } });
    const b = schemaPaths({ threads: { 'chat-1': { title: 'x' }, 'chat-2': { title: 'y' } } });
    expect(a).toEqual(b);
    expect(a).toContain('threads.*.title:string');
  });

  it('still reports a genuinely new field', () => {
    const before = schemaPaths({ threads: { 'chat-1': { title: 'x' } } });
    const after = schemaPaths({ threads: { 'chat-1': { title: 'x', highlightsV2: [] } } });
    expect(after).not.toEqual(before);
    expect(after).toContain('threads.*.highlightsV2:array');
  });

  it('reports a removed or renamed field, which is the forbidden change', () => {
    const before = schemaPaths({ threads: { 'chat-1': { stream: '<p>x</p>' } } });
    const after = schemaPaths({ threads: { 'chat-1': { streamHtml: '<p>x</p>' } } });
    expect(after).not.toEqual(before);
    expect(before).toContain('threads.*.stream:string');
    expect(after).not.toContain('threads.*.stream:string');
  });
});
