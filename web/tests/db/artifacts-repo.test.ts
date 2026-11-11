import { beforeEach, describe, expect, it } from 'vitest';
import { deleteArtifact, getArtifact, listArtifacts, resetArtifactsDbForTests, saveArtifact, type SaveArtifactInput } from '../../src/db/artifacts-repo';
import { artifactSource } from '../../src/projects/extras/artifact-source';
import { blockPayload, hashText } from '../../src/chat/artifact-buttons';

const base: SaveArtifactInput = { projectId: 'p1', title: 'Plan', type: 'MD', content: '# v1', chatId: 'c1', source: 'note-save', dedupeKey: 'note:n1', noteId: 'n1' };

describe('artifacts repo', () => {
  beforeEach(() => { resetArtifactsDbForTests(`artifacts-${Math.random()}`); });

  it('creates v1, then bumps the version for the same key and ignores identical content', async () => {
    const a = await saveArtifact(base);
    expect(a).toMatchObject({ created: true, changed: true });
    expect(a.artifact.version).toBe(1);
    expect((await saveArtifact(base)).changed).toBe(false);
    const b = await saveArtifact({ ...base, content: '# v2' });
    expect(b).toMatchObject({ created: false, changed: true });
    expect(b.artifact.version).toBe(2);
    expect(b.artifact.versions.map(v => v.content)).toEqual(['# v1', '# v2']);
    expect(await listArtifacts('p1')).toHaveLength(1);
  });

  it('keeps projects apart, even with the same key', async () => {
    await saveArtifact(base);
    await saveArtifact({ ...base, projectId: 'p2' });
    expect(await listArtifacts('p1')).toHaveLength(1);
    expect(await listArtifacts('p2')).toHaveLength(1);
  });

  it('survives concurrent saves and deletes by id', async () => {
    const [x, y] = await Promise.all([saveArtifact(base), saveArtifact({ ...base, dedupeKey: 'note:n2', noteId: 'n2' })]);
    expect(await listArtifacts('p1')).toHaveLength(2);
    await deleteArtifact(x.artifact.id);
    expect(await getArtifact(x.artifact.id)).toBeNull();
    expect((await getArtifact(y.artifact.id))?.dedupeKey).toBe('note:n2');
  });

  it('lists without content and gives SVG a preview', async () => {
    await saveArtifact({ ...base, type: 'SVG', dedupeKey: 'b:1', content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
    const [item] = await artifactSource.list('p1');
    expect(item).not.toHaveProperty('content');
    expect(item!.previewUrl).toMatch(/^data:image\/svg\+xml/);
  });

  it('does not preview an SVG that carries a script', async () => {
    await saveArtifact({ ...base, type: 'SVG', dedupeKey: 'b:2', content: '<svg><script>alert(1)</script></svg>' });
    expect((await artifactSource.list('p1'))[0]!.previewUrl).toBeUndefined();
  });
});

describe('block payloads', () => {
  it('maps html, svg and mermaid; ignores other languages and empty code', () => {
    expect(blockPayload('html', '<title>Hi</title><p>x</p>', 'Chat')).toMatchObject({ type: 'HTML', title: 'Hi' });
    expect(blockPayload('svg', '<svg></svg>', 'Chat')).toMatchObject({ type: 'SVG', title: 'Chat — SVG image' });
    expect(blockPayload('mermaid', 'graph TD;A-->B', 'Chat')).toMatchObject({ type: 'MD', content: '```mermaid\ngraph TD;A-->B\n```' });
    expect(blockPayload('python', 'x', 'Chat')).toBeNull();
    expect(blockPayload('html', '  ', 'Chat')).toBeNull();
    expect(hashText('a')).toBe(hashText('a'));
    expect(hashText('a')).not.toBe(hashText('b'));
  });
});
