// Stable, prefixed ids. The prefix is worth the bytes: a raw id in a log or a manifest should say
// what it points at, and an import that remaps ids can assert it remapped the right family.

const rand = (): string => Math.random().toString(36).slice(2, 10);
const stamp = (): string => Date.now().toString(36);

export type IdKind =
  | 'cv' | 'th' | 'ms' | 'pt' | 'sn' | 'cm' | 'rl' | 'ly' | 'rn' | 'sb' | 'ov' | 'as' | 'op';

export const newId = (kind: IdKind): string => `${kind}_${stamp()}${rand()}`;

export const kindOf = (id: string): string => id.slice(0, id.indexOf('_'));

/**
 * FNV-1a over the string. Not a cryptographic hash and not used as one: it answers "is this the
 * same text I froze?" for anchor resolution and export checksums. `crypto.subtle` is async and
 * would make every pure function in the domain layer a promise for no gain here.
 */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Canonical JSON: object keys sorted, so a checksum does not depend on property order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export const checksum = (value: unknown): string => hashText(canonical(value));
