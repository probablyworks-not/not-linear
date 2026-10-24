import type { Skill } from './types';

// Minimal SKILL.md frontmatter reader/writer. Handles exactly what the library uses: `key: value`
// scalars and `[a, b]` inline lists. No YAML dependency on purpose.

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function list(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return /^(true|yes|1)$/i.test(raw.trim());
}

/** Parses a SKILL.md. Returns null when it has no frontmatter or no name. */
export function parseSkill(source: string, fallbackLayer = 'custom'): Skill | null {
  const m = FM.exec(source.replace(/^\u{FEFF}/u, ''));
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const name = fm.name?.trim();
  if (!name) return null;
  const priority = Number(fm.priority);
  return {
    name,
    description: fm.description ?? '',
    layer: fm.layer || fallbackLayer,
    whenToUse: fm.when_to_use ?? '',
    keywords: fm.keywords ? list(fm.keywords) : [],
    priority: Number.isFinite(priority) ? priority : 0,
    always: bool(fm.always, false),
    auto: bool(fm.auto, true),
    tools: fm.tools ? list(fm.tools) : [],
    body: m[2]!.trim(),
  };
}

const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ').trim();

/** Serializes back to SKILL.md (export, and the editor's raw view). Omits defaults. */
export function serializeSkill(s: Skill): string {
  const lines = ['---', `name: ${s.name}`, `description: ${oneLine(s.description)}`, `layer: ${s.layer}`];
  if (s.whenToUse) lines.push(`when_to_use: ${oneLine(s.whenToUse)}`);
  if (s.keywords.length) lines.push(`keywords: [${s.keywords.join(', ')}]`);
  if (s.priority) lines.push(`priority: ${s.priority}`);
  if (s.always) lines.push('always: true');
  if (!s.auto) lines.push('auto: false');
  if (s.tools.length) lines.push(`tools: [${s.tools.join(', ')}]`);
  lines.push('---', '', s.body.trim(), '');
  return lines.join('\n');
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
