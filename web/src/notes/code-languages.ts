// The languages the note editor's code block can highlight. Shared so the converter can tell a
// language the editor knows from one it does not: a `lang` it cannot highlight throws while the
// block renders, which is outside any try/catch and takes the whole app down with it.
// The ids are legacy's own, so `lang` round-trips unchanged.

export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  plain: { name: 'Plain text' }, js: { name: 'JavaScript', aliases: ['javascript'] }, ts: { name: 'TypeScript', aliases: ['typescript'] },
  python: { name: 'Python', aliases: ['py'] }, rust: { name: 'Rust' }, go: { name: 'Go' }, html: { name: 'HTML' },
  css: { name: 'CSS' }, sql: { name: 'SQL' }, json: { name: 'JSON' }, bash: { name: 'Bash', aliases: ['sh', 'shell'] },
};

export const FALLBACK_LANGUAGE = 'plain';

const KNOWN = new Set<string>();
for (const [id, lang] of Object.entries(CODE_LANGUAGES)) {
  KNOWN.add(id);
  for (const a of lang.aliases ?? []) KNOWN.add(a);
}

/** True when the editor can render a code block carrying this `lang`. */
export function isSupportedCodeLanguage(lang: unknown): boolean {
  return typeof lang === 'string' && KNOWN.has(lang);
}
