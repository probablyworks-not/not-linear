import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Same idea as legacy-source.ts, for frontend/views/notes.js: cut a function out as text so a test can
// run the REAL legacy code next to the port.

export const NOTES_JS = readFileSync(resolve(__dirname, '../../../frontend/views/notes.js'), 'utf8');

export function notesFnSource(name: string): string {
  const start = NOTES_JS.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in notes.js`);
  let i = NOTES_JS.indexOf('(', start);
  let parens = 0;
  for (; i < NOTES_JS.length; i++) {
    if (NOTES_JS[i] === '(') parens += 1;
    else if (NOTES_JS[i] === ')') { parens -= 1; if (parens === 0) break; }
  }
  let depth = 0;
  for (i = NOTES_JS.indexOf('{', i); i < NOTES_JS.length; i++) {
    const c = NOTES_JS[i];
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return NOTES_JS.slice(start, i + 1); }
  }
  throw new Error(`unterminated ${name}`);
}

export function notesFns<T>(names: string[], scope: Record<string, unknown>, ret: string): T {
  const src = [...names.map(notesFnSource), `return ${ret};`].join('\n');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(...Object.keys(scope), src)(...Object.values(scope)) as T;
}
