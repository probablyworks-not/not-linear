import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOL_SPECS } from '../../src/providers/tool-specs';

// Tool descriptions are prompt text: the model's behaviour depends on their
// exact wording, so they are not documentation to be tidied. While app.js is
// still the live implementation, it is the oracle — these assertions prove the
// registry carries the same strings rather than a paraphrase someone improved.
//
// When app.js stops building tools (P5d), delete this file: there will be no
// oracle left to compare against, and keeping it would assert against a corpse.
const APP_JS = readFileSync(resolve(__dirname, '../../../frontend/app.js'), 'utf8');

// P7 connectors and chat-to-notes exist only in /web/, so they have no legacy wording to match.
const LEGACY_SPECS = TOOL_SPECS.filter((s) => !s.name.startsWith('github_') && s.name !== 'create_note');

describe('tool descriptions are carried over verbatim from app.js', () => {
  it.each(LEGACY_SPECS.map((s) => [s.name, s.description] as const))(
    '%s description appears verbatim in app.js',
    (_name, description) => {
      // app.js writes these inside single-quoted JS strings, so an apostrophe
      // is escaped there but not in our TS template literal.
      const escaped = description.replace(/'/g, "\\'");
      const present = APP_JS.includes(description) || APP_JS.includes(escaped);
      expect(present).toBe(true);
    },
  );

  it.each(LEGACY_SPECS.map((s) => [s.name] as const))('%s is still a tool app.js knows', (name) => {
    expect(APP_JS).toContain(`name: '${name}'`);
  });

  it('app.js does not define a tool the registry is missing', () => {
    const inApp = [...APP_JS.matchAll(/name:\s*'([a-z_]+)',\s*\n\s*description:/g)].map((m) => m[1]);
    const known = new Set(LEGACY_SPECS.map((s) => s.name as string));
    const missing = [...new Set(inApp)].filter((n) => !known.has(n!));
    expect(missing, `app.js defines tools the registry lacks: ${missing.join(', ')}`).toEqual([]);
  });
});
