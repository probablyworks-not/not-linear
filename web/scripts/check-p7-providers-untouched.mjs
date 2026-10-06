// P7 gate (handoff): every P7 seam must add its feature without editing a provider file. Fails if
// any commit whose subject starts with "P7" touches web/src/providers/{claude,deepseek,openai,gemini}.ts.
import { execFileSync } from 'node:child_process';

const PROVIDERS = /^web\/src\/providers\/(claude|deepseek|openai|gemini)\.ts$/;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

const bad = [];
for (const sha of git('log', '--format=%H', '--grep=^P7').split('\n').filter(Boolean)) {
  const files = git('show', '--name-only', '--format=', sha).split('\n').filter(f => PROVIDERS.test(f));
  if (files.length) bad.push(`${sha.slice(0, 7)} touches ${files.join(', ')}`);
}
if (bad.length) {
  console.error(`P7 gate failed: a seam edited a provider file, so the seam is wrong.\n${bad.join('\n')}`);
  process.exit(1);
}
console.log('P7 gate ok: no P7 commit touches a provider file.');
