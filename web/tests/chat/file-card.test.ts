import { addArtifactButtons, fileNameFor, fileSize, FILE_CARD_CLASS } from '../../src/chat/artifact-buttons';
import { renderMarkdown } from '../../src/lib/markdown';

const PAGE = '<!DOCTYPE html>\n<html><head><title>Should we just use MCP?</title></head><body><p>No.</p></body></html>';

function render(markdown: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'msg ai';
  root.innerHTML = renderMarkdown(markdown);
  addArtifactButtons(root);
  return root;
}

describe('the file card on a generated html block', () => {
  it('names itself from the document title and offers preview, download and save', () => {
    const card = render(PAGE).querySelector<HTMLElement>(`.${FILE_CARD_CLASS}`)!;
    expect(card.querySelector('.artifact-card-title')!.textContent).toBe('Should we just use MCP?');
    expect(card.querySelector('.artifact-card-meta')!.textContent).toContain('HTML page');
    const labels = Array.from(card.querySelectorAll('.artifact-card-actions button')).map(b => b.textContent);
    expect(labels).toEqual(['Preview', 'Download .html', 'Save to artifacts', 'Show code']);
  });

  it('carries the markup on the card and keeps the original code block for Copy and Show code', () => {
    const card = render(PAGE).querySelector<HTMLElement>(`.${FILE_CARD_CLASS}`)!;
    expect(card.dataset.code).toContain('<!DOCTYPE html>');
    expect(card.querySelector('pre code')!.textContent).toContain('<!DOCTYPE html>');
    expect(card.querySelector('.code-copy-btn')).not.toBeNull();
  });

  it('is built straight from an unfenced raw HTML reply too', () => {
    expect(render(PAGE.replace('<!DOCTYPE html>\n', '')).querySelector(`.${FILE_CARD_CLASS}`)).not.toBeNull();
  });

  it('leaves an ordinary code block as a code block, and runs only once', () => {
    const root = render('```python\nprint(1)\n```');
    expect(root.querySelector(`.${FILE_CARD_CLASS}`)).toBeNull();
    const page = render(PAGE);
    addArtifactButtons(page);
    expect(page.querySelectorAll('.artifact-card')).toHaveLength(1);
  });
});

describe('file naming and size', () => {
  it('slugifies the title and keeps the extension', () => {
    expect(fileNameFor('html', 'Should we just use MCP?')).toBe('should-we-just-use-mcp.html');
    expect(fileNameFor('svg', 'Flow — SVG image')).toBe('flow.svg');
    expect(fileNameFor('html', '???')).toBe('page.html');
  });

  it('reports the size the file would land on disk as', () => {
    expect(fileSize('abc')).toBe('3 B');
    expect(fileSize('x'.repeat(6246))).toBe('6.1 KB');
  });
});
