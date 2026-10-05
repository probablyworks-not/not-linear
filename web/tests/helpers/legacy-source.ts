import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Differential tests compare React-side code with the REAL legacy function, cut out of
// frontend/app.js as text and evaluated against stand-ins for the few variables it closes over.
// That keeps "same behaviour" from depending on anyone's reading of the source.

export const APP_JS = readFileSync(resolve(__dirname, '../../../frontend/app.js'), 'utf8');

/** The source of `function <name>(...) { ... }` as it appears in app.js, through its closing brace. */
export function fnSource(name: string): string {
  let start = APP_JS.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in app.js`);
  if (APP_JS.slice(start - 6, start) === 'async ') start -= 6; // keep `async`
  // Skip the parameter list first: a default like `{ extraContext = '' } = {}` has braces of its own.
  let i = APP_JS.indexOf('(', start);
  let parens = 0;
  for (; i < APP_JS.length; i++) {
    if (APP_JS[i] === '(') parens += 1;
    else if (APP_JS[i] === ')') { parens -= 1; if (parens === 0) break; }
  }
  let depth = 0;
  for (i = APP_JS.indexOf('{', i); i < APP_JS.length; i++) {
    const c = APP_JS[i];
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return APP_JS.slice(start, i + 1); }
  }
  throw new Error(`unterminated ${name}`);
}

/** Builds legacy functions together, with `scope` as the variables they close over. */
export function legacyFns<T>(names: string[], scope: Record<string, unknown> = {}, prelude = '', ret: string = names[names.length - 1]!): T {
  const src = [prelude, ...names.map(fnSource), `return ${ret};`].join('\n');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(...Object.keys(scope), src)(...Object.values(scope)) as T;
}
