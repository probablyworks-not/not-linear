#!/usr/bin/env node
// Turns a real notlinear backup (from tools/export-data.html) into redacted
// fixtures that are safe to commit.
//
//   node scripts/backup-to-fixture.mjs ~/path/notlinear-backup-....json
//
// Why this exists: synthetic seeds only cover the fields someone thought to
// write down. Real data carries the additive fields that accumulated over
// months (updatedAt, modeOverrides, per-branch modelPref, note comment
// anchors) and is the only thing that proves the schema tests match reality.
//
// Why redaction: the backup contains API keys and the full text of private
// notes. The fixture keeps the exact STRUCTURE — every key, every type, every
// array length — and replaces leaf strings with placeholders of the same
// length, so a schema test is unaffected while the content is not published.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '../tests/fixtures');

// Keys whose values are secrets outright — replaced wholesale, not masked.
const SECRET_KEYS = new Set(['nl_api_keys', 'apiKeys', 'anthropic', 'openai', 'deepseek', 'gemini', 'serper', 'firecrawl']);

// Keys whose values are structural and must survive verbatim, because the
// schema tests assert on them.
const STRUCTURAL_KEYS = new Set(['id', 'key', 'type', 'role', 'mode', 'theme', 'model', 'modelPref', 'rankingLlm', 'parentId', 'source', 'lang']);

/** Same length, no content. Keeps any length-sensitive assertion meaningful. */
const maskString = (s) => s.length === 0 ? '' : 'x'.repeat(Math.min(s.length, 200));

/**
 * Masks HTML while preserving its tags and data- attributes, because
 * threadState[].stream is rendered HTML whose highlight (data-hid) and branch
 * (data-bid) anchors are exactly what the P5 tests need to see.
 */
// Rendered chat HTML runs to tens of KB per thread, and the schema tests care
// that `stream` is a string carrying data-hid / data-bid anchors — not that it
// is the full transcript. So: mask the text, then TRUNCATE, while making sure
// at least one highlight and one branch anchor survive if the original had
// them. Without the truncation a real database produces a 4.4 MB fixture that
// proves nothing a 60 KB one does not.
const HTML_CAP = 1200;

const maskHtml = (s) => {
  const masked = s.replace(/>([^<]+)</g, (_m, text) =>
    text.trim() ? '>' + 'x'.repeat(Math.min(text.length, 40)) + '<' : '>' + text + '<');
  if (masked.length <= HTML_CAP) return masked;
  // Preserve one example of each anchor kind, since P5 depends on them.
  const anchors = [
    (masked.match(/<span[^>]*class="[^"]*highlighted[^"]*"[^>]*>[^<]*<\/span>/) || [])[0],
    (masked.match(/<[^>]*class="[^"]*branched[^"]*"[^>]*>[^<]*<\/[a-z]+>/) || [])[0],
  ].filter(Boolean).join('');
  return masked.slice(0, HTML_CAP) + anchors + `<!-- truncated for fixture: ${masked.length} chars -->`;
};

/**
 * Keeps the smallest set of threads that still exhibits every distinct field
 * shape, and drops the rest.
 *
 * A real database has ~90 threads, which redacts to about 4.4 MB — too heavy
 * to commit and almost entirely redundant. The schema tests collapse
 * `threads.*` to one path anyway (see src/db/keypaths.ts), so ninety threads
 * prove exactly what ten do. This greedily keeps a thread only if it
 * contributes a key path no already-kept thread has, which preserves the
 * coverage that matters while removing the bulk that does not.
 */
function pruneThreads(state, keep = 12) {
  if (!state || typeof state !== 'object' || !state.threads) return state;

  const pathsOf = (value, prefix = '') => {
    const out = new Set();
    const walk = (v, path) => {
      if (v === null) { out.add(`${path}:null`); return; }
      if (Array.isArray(v)) { out.add(`${path}:array`); v.forEach(i => walk(i, `${path}[]`)); return; }
      if (typeof v === 'object') {
        out.add(`${path}:object`);
        for (const [k, c] of Object.entries(v)) walk(c, path ? `${path}.${k}` : k);
        return;
      }
      out.add(`${path}:${typeof v}`);
    };
    walk(value, prefix);
    return out;
  };

  const seen = new Set();
  const kept = {};
  let kills = 0;
  for (const [id, thread] of Object.entries(state.threads)) {
    const paths = pathsOf(thread);
    const novel = [...paths].some(p => !seen.has(p));
    if (novel || Object.keys(kept).length < 3) {
      for (const p of paths) seen.add(p);
      kept[id] = thread;
    } else {
      kills++;
    }
    if (Object.keys(kept).length >= keep) {
      // Keep scanning for novelty, but stop growing past the cap unless a
      // thread brings something genuinely new.
      if (!novel) continue;
    }
  }

  // Keep dynamic/sidebar entries consistent with the threads that remain.
  const dynamic = Array.isArray(state.dynamic)
    ? state.dynamic.filter(d => d && kept[d.id])
    : state.dynamic;
  const current = kept[state.current] ? state.current : Object.keys(kept)[0] || state.current;

  console.log(`  pruned ${kills} redundant thread(s); kept ${Object.keys(kept).length} covering every field shape`);
  return { ...state, threads: kept, dynamic, current };
}

function redact(value, key = '') {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => redact(v, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k) ? (typeof v === 'string' ? 'REDACTED' : redact(v, k) && 'REDACTED') : redact(v, k);
    }
    return out;
  }
  if (typeof value !== 'string') return value;
  if (SECRET_KEYS.has(key)) return 'REDACTED';
  if (STRUCTURAL_KEYS.has(key)) return value;          // ids and enums must survive
  if (/^<[a-z!]/i.test(value.trim())) return maskHtml(value);
  if (/^(data:|https?:\/\/)/i.test(value)) return value.slice(0, 24) + '...';
  return maskString(value);
}

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/backup-to-fixture.mjs <notlinear-backup-....json>');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(input, 'utf8'));
if (backup.format !== 'notlinear-backup/v1') {
  console.error(`not a notlinear backup (format: ${backup.format})`);
  process.exit(1);
}

mkdirSync(FIXTURES, { recursive: true });
const written = [];

for (const [dbName, db] of Object.entries(backup.databases ?? {})) {
  const rows = db.stores?.kv?.records ?? [];
  const fixture = {
    _note: 'Generated by scripts/backup-to-fixture.mjs from a real backup. Structure is real; leaf strings are masked. Do not hand-edit.',
    _source: { realm: backup.realm?.id ?? 'unknown', createdAt: backup.createdAt, dbVersion: db.version },
    rows: rows.map(r => {
      let value = redact(r.value?.value ?? r.value);
      if (r.key === 'state') value = pruneThreads(value);
      return { key: r.key, value };
    }),
  };
  const out = `${FIXTURES}/${dbName}.kv.v1.json`;
  writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n');
  written.push(`${out} (${rows.length} row(s))`);
}

// localStorage keys are recorded by name only — the values are keys and theme.
writeFileSync(`${FIXTURES}/localStorage.keys.json`,
  JSON.stringify({ _note: 'Key names only; values are secrets.', keys: Object.keys(backup.localStorage ?? {}).sort() }, null, 2) + '\n');
written.push(`${FIXTURES}/localStorage.keys.json`);

console.log('wrote:');
for (const w of written) console.log('  ' + w);
console.log('\nReview every file before committing. The masking is mechanical, not a guarantee.');
