import { renderMarkdown } from '../../src/lib/markdown';

const pricing = String.raw`A useful pricing model is:
\[
\text{Buyer price} \approx
\text{market benchmark}
+ \text{quality premium}
+ \text{co-benefit premium}
- \text{risk/volume discounts}
\]
The \(44/12\) factor.`;

it('typesets the desktop pricing reply as one equation, not a markdown list', () => {
  const root = document.createElement('div');
  root.innerHTML = renderMarkdown(pricing);
  expect(root.querySelectorAll('.katex')).toHaveLength(2);
  expect(root.querySelectorAll('.md-math-block')).toHaveLength(1);
  expect(root.querySelector('ul')).toBeNull();
  expect(root.querySelector('.katex-error')).toBeNull();
});

it('typesets dollar display math and preserves code and currency', () => {
  expect(renderMarkdown('$$x_1^2$$')).toContain('katex-display');
  for (const text of ['`'+String.raw`\(x\)`+'`', '```latex\n'+pricing+'\n```', '```latex\n'+pricing]) {
    expect(renderMarkdown(text)).not.toContain('class="katex"');
  }
  expect(renderMarkdown('Costs $5 or $10.')).toContain('Costs $5 or $10.');
});

it('handles incomplete streams, invalid TeX and untrusted content safely', () => {
  expect(renderMarkdown(String.raw`\[x_1`)).toContain('x_1');
  expect(() => renderMarkdown(String.raw`\(\badcommand{x}\)`)).not.toThrow();
  expect(renderMarkdown(String.raw`\(\text{<img src=x onerror=alert(1)>}\)`)).not.toContain('<img');
});
