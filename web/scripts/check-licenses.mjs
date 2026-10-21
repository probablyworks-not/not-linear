// CI gate: fail if a production dependency has a licence we have not reviewed, or if a
// copyleft/commercial BlockNote package (@blocknote/xl-*) sneaks in.
// Run:  cd web && node scripts/check-licenses.mjs
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'MIT-0',
  'BlueOak-1.0.0', 'MPL-2.0', 'EPL-2.0', '(MPL-2.0 OR Apache-2.0)',
]);
// Reviewed by hand: the package.json has no licence field, but the package ships an MIT licence file.
const REVIEWED = new Map([['khroma', 'MIT (licence file)']]);

const out = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const bad = [];
for (const [license, pkgs] of Object.entries(out)) {
  for (const p of pkgs) {
    if (p.name.startsWith('@blocknote/xl-')) bad.push(`${p.name}: GPL/commercial BlockNote package`);
    else if (!ALLOWED.has(license) && !REVIEWED.has(p.name)) bad.push(`${p.name}@${p.versions?.join(',')}: ${license}`);
  }
}
if (bad.length) {
  console.error('Disallowed or unreviewed licences:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log(`licences ok (${Object.values(out).reduce((n, a) => n + a.length, 0)} production packages)`);
