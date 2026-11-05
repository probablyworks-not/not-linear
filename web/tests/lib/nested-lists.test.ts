import { renderMarkdown } from '../../src/lib/markdown';
import { structureReply } from '../../src/canvas/view/structure-reply';

it('preserves mixed nested lists and outer numbering across blank lines', () => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown('1. First\n\n2. Second\n   - Child\n     - Grandchild\n       1. Detail\n       2. More detail\n   - Sibling\n\n3. Third');
  structureReply(root);
  expect(root.querySelectorAll(':scope > ol > li')).toHaveLength(3);
  expect(root.querySelectorAll('ol > li > ul > li > ul > li > ol > li')).toHaveLength(2);
  expect(root.querySelector('ol > li:nth-child(2) > ul')?.textContent).toContain('Sibling');
});

it('honors resumed numbers and keeps wrapped text with the parent item', () => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown('7. Seven\n   wrapped text\n\n8. Eight');
  expect(root.querySelector('ol')?.start).toBe(7);
  expect(root.querySelectorAll('ol > li')).toHaveLength(2);
  expect(root.querySelector('li > p')?.textContent).toBe('wrapped text');
});
