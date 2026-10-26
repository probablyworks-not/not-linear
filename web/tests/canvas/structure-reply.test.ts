import { renderMarkdown } from '../../src/lib/markdown';
import { structureReply } from '../../src/canvas/view/structure-reply';

const render = (markdown: string): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = renderMarkdown(markdown);
  structureReply(el);
  return el;
};

describe('structureReply — nesting a named item\'s body under it', () => {
  it('folds label lines following a solo bullet item into that <li>', () => {
    const el = render([
      '## Major private players',
      '',
      '- Re Sustainability',
      'Focus: Large-scale collection, transport, processing.',
      'Model: Long-term municipal and industrial contracts.',
      '',
      '- Antony Waste Handling Cell',
      'Focus: Municipal solid-waste collection and transportation.',
    ].join('\n'));

    const lists = el.querySelectorAll('ul');
    expect(lists).toHaveLength(2);
    expect(lists[0]!.children).toHaveLength(1);
    const firstItem = lists[0]!.children[0]!;
    expect(firstItem.tagName).toBe('LI');
    expect(firstItem.textContent).toContain('Re Sustainability');
    expect(firstItem.querySelectorAll('p.md-label-line')).toHaveLength(2);
    expect(firstItem.textContent).toContain('Focus:');
    expect(firstItem.textContent).toContain('Model:');
    // The second item's body must not have leaked into the first.
    expect(firstItem.textContent).not.toContain('Antony');

    const secondItem = lists[1]!.children[0]!;
    expect(secondItem.querySelectorAll('p.md-label-line')).toHaveLength(1);
  });

  it('wraps a lone "N. Name" number-line and its body in one indented block', () => {
    const el = render([
      '## Major private players',
      '',
      '1. Re Sustainability',
      'Focus: Large-scale collection, transport, processing.',
      'Model: Long-term municipal and industrial contracts.',
    ].join('\n'));

    const numberLine = el.querySelector('p.md-number-line')!;
    expect(numberLine.parentElement?.classList.contains('nl-number-item')).toBe(true);
    expect(numberLine.parentElement?.querySelectorAll('p.md-label-line')).toHaveLength(2);
  });

  it('leaves an ALL-CAPS label line alone for groupCallouts instead of absorbing it as body', () => {
    const el = render([
      '- Re Sustainability',
      'Focus: Large-scale collection.',
      "WHO IT'S FOR: Municipalities and brand owners.",
      'Extra detail about who it serves.',
    ].join('\n'));

    const item = el.querySelector('li')!;
    expect(item.textContent).toContain('Focus:');
    expect(item.textContent).not.toContain("WHO IT'S FOR");

    const callout = el.querySelector('.nl-callout')!;
    expect(callout).toBeTruthy();
    expect(callout.textContent).toContain("WHO IT'S FOR");
    expect(callout.textContent).toContain('Extra detail about who it serves.');
  });

  it('leaves an ordinary multi-item list untouched', () => {
    const el = render([
      '- first item',
      '- second item',
      '- third item',
      '',
      'Source: a citation unrelated to any single item above.',
    ].join('\n'));

    const list = el.querySelector('ul')!;
    expect(list.children).toHaveLength(3);
    expect(list.textContent).not.toContain('Source:');
    expect(el.querySelector('p.md-label-line')?.textContent).toContain('Source:');
  });
});
