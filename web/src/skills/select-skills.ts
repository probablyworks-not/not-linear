import { bm25, type Doc } from './bm25';
import type { ResolvedSkill, SkillsMeta } from './types';

export interface Selection { skill: ResolvedSkill; score: number; reason: 'picked' | 'always' | 'pinned' | 'match'; matched: string[] }

export interface SelectInput {
  skills: ResolvedSkill[];
  meta: SkillsMeta;
  /** The user's message (weighted heavily). */
  query: string;
  /** Recent context, e.g. the last assistant reply (weighted lightly). */
  context?: string;
  /** Names the user picked for this message with /skills. Honoured even when disabled; they bypass the budget. */
  forced?: string[];
  /** Max automatically matched skills. */
  limit?: number;
  /** Approx token budget for all injected bodies. */
  tokenBudget?: number;
  /** Minimum BM25 score, and minimum fraction of the best score, for a match. */
  minScore?: number;
  relativeCut?: number;
}

export const DEFAULT_LIMIT = 3;
export const DEFAULT_TOKEN_BUDGET = 1500;
export const DEFAULT_MIN_SCORE = 2.5;

const tokensOf = (s: string): number => Math.ceil(s.length / 4);

export function docOf(s: ResolvedSkill): Doc {
  return {
    id: s.name,
    fields: [
      { text: s.name.replace(/-/g, ' '), weight: 3 },
      { text: s.keywords.join(' '), weight: 3 },
      { text: s.description, weight: 2 },
      { text: s.whenToUse, weight: 2 },
      { text: s.body, weight: 1 },
    ],
  };
}

/** Always-on and pinned skills first, then BM25 matches. Respects disabled, the limit and the budget. */
export function selectSkills(input: SelectInput): Selection[] {
  const { skills, meta, query, forced = [], context = '', limit = DEFAULT_LIMIT, tokenBudget = DEFAULT_TOKEN_BUDGET, minScore = DEFAULT_MIN_SCORE, relativeCut = 0.5 } = input;
  const live = skills.filter(s => s.enabled);
  const out: Selection[] = [];
  let used = 0;
  const take = (skill: ResolvedSkill, score: number, reason: Selection['reason'], matched: string[]): void => {
    if (out.some(o => o.skill.name === skill.name)) return;
    const cost = tokensOf(skill.body);
    // Forced skills (always / pinned) ignore the budget; the user asked for them.
    if (reason === 'match' && used + cost > tokenBudget) return;
    used += cost;
    out.push({ skill, score, reason, matched });
  };
  for (const name of forced) { const s = skills.find(k => k.name === name); if (s) take(s, 0, 'picked', []); }
  for (const s of live) if (s.always) take(s, 0, 'always', []);
  for (const s of live) if (meta.pinned.includes(s.name)) take(s, 0, 'pinned', []);
  if (!meta.auto) return out;

  const candidates = live.filter(s => s.auto && !s.always);
  const text = query + (context ? ' ' + context.slice(-400) : '');
  const ranked = bm25(candidates.map(docOf), text)
    .map(r => ({ r, skill: candidates.find(c => c.name === r.id)! }))
    .filter(x => x.r.score >= minScore)
    .sort((a, b) => b.r.score - a.r.score || b.skill.priority - a.skill.priority);
  const best = ranked[0]?.r.score ?? 0;
  let matches = 0;
  for (const { r, skill } of ranked) {
    if (matches >= limit || r.score < best * relativeCut) break;
    const before = out.length;
    take(skill, r.score, 'match', r.matched);
    if (out.length > before) matches++;
  }
  return out;
}
