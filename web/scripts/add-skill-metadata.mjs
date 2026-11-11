// One-off, idempotent: adds P7 selection metadata (when_to_use, keywords, always, auto) to the
// notlinear-skills library from each skill's own description and name. Safe to re-run; it never
// overwrites a key that is already present, so hand-tuned values survive.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../notlinear-skills/skills/', import.meta.url).pathname;
const STOP = new Set('a an and are as at be by for from how in into is it of on or that the this to use used when with your you their any every each its not'.split(' '));

for (const layer of readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory())) {
  for (const sk of readdirSync(join(ROOT, layer.name), { withFileTypes: true }).filter(d => d.isDirectory())) {
    const file = join(ROOT, layer.name, sk.name, 'SKILL.md');
    const src = readFileSync(file, 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
    if (!m) continue;
    const fm = m[1];
    const has = k => new RegExp(`^${k}:`, 'm').test(fm);
    const desc = /^description:\s*(.*)$/m.exec(fm)?.[1] ?? '';
    const add = [];
    if (!has('when_to_use')) {
      const sentence = desc.split(/(?<=[.!?])\s+/).find(x => /\buse\b/i.test(x) || /\bwhen\b/i.test(x)) ?? desc;
      add.push(`when_to_use: ${sentence}`);
    }
    if (!has('keywords')) {
      const words = [...sk.name.split('-'), ...desc.toLowerCase().split(/[^a-z0-9]+/)].filter(w => w.length > 3 && !STOP.has(w));
      add.push(`keywords: [${[...new Set(words)].slice(0, 8).join(', ')}]`);
    }
    // Foundation skills stay opt-in: always-on would add ~1.7k tokens to every prompt and overlap the base prompt.
    if ((layer.name === 'modes' || sk.name === 'mode-router') && !has('auto')) add.push('auto: false');
    if (add.length) writeFileSync(file, src.replace(/\n---\n/, `\n${add.join('\n')}\n---\n`));
  }
}
