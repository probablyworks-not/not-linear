import { ESLint } from 'eslint';

// The rule is the enforcement for "no literal hex anywhere in web/" (bug #022).
// A lint rule nobody has seen fail proves nothing, so this feeds it offenders.
async function lint(code: string) {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath: 'src/probe.tsx' });
  return result!.messages.filter(m => m.ruleId === 'no-restricted-syntax');
}

describe('no-restricted-syntax colour rule', () => {
  it.each([
    ["hex", "export const a = '#fff';"],
    ["8-digit hex", "export const a = '#A0A0A0ff';"],
    ["rgb()", "export const a = 'rgb(0,0,0)';"],
    ["rgba()", "export const a = 'rgba(0,0,0,.5)';"],
    ["hsl()", "export const a = 'hsl(0 0% 0%)';"],
    ["template literal", "export const a = `border: 1px solid #333`;"],
  ])('rejects %s', async (_n, code) => {
    expect((await lint(code)).length).toBeGreaterThan(0);
  });

  it.each([
    ['var()', "export const a = 'var(--accent)';"],
    ['a tailwind token class', "export const a = 'bg-bg-2 text-text-2';"],
    ['a DOM id that merely contains a hash-like fragment', "export const a = 'item-#1';"],
  ])('allows %s', async (_n, code) => {
    expect(await lint(code)).toEqual([]);
  });
});
