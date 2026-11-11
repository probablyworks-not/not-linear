// A skill is a system-prompt augmentation: a SKILL.md with frontmatter metadata that tells the
// selector when it applies. Provider-agnostic by construction: it only ever becomes prompt text.

export interface Skill {
  /** Unique slug, e.g. `pre-mortem`. */
  name: string;
  /** What the skill does. Indexed by the selector. */
  description: string;
  /** Group in the UI: foundation, modes, moves, research, technical, product, synthesis, meta, or custom. */
  layer: string;
  /** Trigger sentence(s): when this skill should be applied. Indexed by the selector. */
  whenToUse: string;
  /** Trigger terms, boosted by the selector. */
  keywords: string[];
  /** Tie-break between near-equal scores; higher wins. */
  priority: number;
  /** Injected into every turn (subject to the user's enabled set). */
  always: boolean;
  /** False keeps it out of automatic selection; it can still be pinned. */
  auto: boolean;
  /** Tool names the skill expects. Parsed and shown only; not wired to tool execution yet. */
  tools: string[];
  /** Markdown body: the instructions the model receives. */
  body: string;
}

export type SkillField = keyof Skill;

/** The fields a user can change on a built-in skill. `name` and `layer` of a built-in are fixed. */
export const EDITABLE_FIELDS = ['description', 'whenToUse', 'keywords', 'priority', 'always', 'auto', 'body'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type SkillOverride = Partial<Pick<Skill, EditableField>>;

export interface ResolvedSkill extends Skill {
  builtin: boolean;
  edited: boolean;
  enabled: boolean;
  pinned: boolean;
}

export interface SkillsMeta {
  /** Names the user switched off: never injected, pinned or not. */
  disabled: string[];
  /** Names injected into every turn regardless of score. */
  pinned: string[];
  /** Master switch for automatic (BM25) selection. */
  auto: boolean;
}

export const DEFAULT_SKILLS_META: SkillsMeta = { disabled: [], pinned: [], auto: true };
