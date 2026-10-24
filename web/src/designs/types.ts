import type { ClarifyAnswer, ClarifyQuestion } from '../chat/clarify';

// Shapes only, no logic. A "run" is one pass over one design bundle: parse the screens, infer the
// user flows, write the requirements, review them, freeze the spec.
//
// `DesignSpec` and below mirror the `design-spec` schema that already exists outside the app
// (`~/.claude/skills/design-extraction/SKILL.md`), as TS. It is the extraction contract — reuse it
// rather than inventing a second shape, so a spec produced here and one produced by the
// Claude Code agent stay readable by the same consumers.

export type Stage = 'parsed' | 'flows' | 'questions' | 'requirements' | 'review' | 'frozen';
export type StageStatus = 'idle' | 'running' | 'done' | 'failed';

/**
 * `edited` is deliberately distinct from `accepted`: the exported spec marks human-authored text,
 * and a later eval can measure how often the model was right first time. `stale` is an item a
 * re-run no longer produces but which a human had already accepted — kept, never silently dropped.
 */
export type ItemStatus = 'pending' | 'accepted' | 'edited' | 'rejected' | 'stale';

export type Priority = 'must' | 'should' | 'could';

export interface RunCounts { screens: number; flows: number; requirements: number; pending: number }

/** The index row's entry: metadata only, so listing runs never loads a bundle. */
export interface SpecRun {
  id: string;
  projectId: string;
  title: string;
  stage: Stage;
  status: StageStatus;
  counts: RunCounts;
  /** False when the picked model could not read the bundle's screenshots (vision is Claude-only). */
  visionUsed: boolean;
  createdAt: number;
  updatedAt: number;
  frozenAt?: number;
  specArtifactId?: string;
  /** Set when this run was forked from a frozen one after the design changed. */
  parentRunId?: string;
}

export type BundleFileKind = 'dc' | 'readme' | 'image' | 'support' | 'other';

export interface BundleFile {
  name: string;
  size: number;
  kind: BundleFileKind;
  /** Text for `dc`/`readme`, null for an image (which carries `base64` instead). */
  content: string | null;
  base64?: string;
}

export interface DesignBundle {
  files: BundleFile[];
  /** Nothing is dropped silently: a refused file is listed here with the reason. */
  skipped: { name: string; reason: string }[];
}

export type FidelityTier = 'strict' | 'standard';
export type ElementKind = 'field' | 'button' | 'text' | 'conditional_element' | 'other';

export interface SpecElement {
  kind: ElementKind;
  /** Literal text, copied exactly from the source file. */
  label_text: string | null;
  placeholder_text?: string | null;
  /** The `{{onClick}}` binding name — an INTENDED action, never an implemented one. */
  action_binding: string | null;
  required?: boolean | null;
  /** For `conditional_element`: the `{{binding}}` this element's presence depends on. */
  expected_condition: string | null;
}

export interface RepeatedStructure {
  list_binding: string;
  item_alias: string;
  item_fields: { field: string; inferred_meaning: string }[];
}

export interface Screen {
  /** The literal `{{stateName}}` binding. Ground truth — never an invented label. */
  id: string;
  /** Inferred, unlike `id`. Do not treat as ground truth. */
  display_name?: string;
  parent_state: string | null;
  fidelity_tier: FidelityTier;
  boundary_confidence: 'high' | 'low';
  boundary_note?: string;
  elements: SpecElement[];
  repeated_structures: RepeatedStructure[];
}

export interface ComponentTokenSet {
  component: string;
  variants: { context: string; values: Record<string, string>; is_majority_pattern: boolean }[];
}

export interface UnresolvedBinding { binding_name: string; screen_id: string; property: string; note?: string }
export interface UnreferencedBinding { binding_name: string; found_near: string; note?: string }

export interface DesignSpec {
  source_file: string;
  /** Set when several layout-variant files sharing state names were merged. */
  combined_from?: string[];
  extracted_at: string;
  screens: Screen[];
  design_tokens: { components: ComponentTokenSet[] };
  /** State-dependent style bindings; `support.js` is not executed, so these stay open. */
  unresolved_style_bindings: UnresolvedBinding[];
  /** Defined but never rendered — candidates for dead-code-as-spec. Never buildable. */
  flagged_unreferenced_bindings: UnreferencedBinding[];
}

export type EvidenceKind = 'dc' | 'readme' | 'screenshot' | 'answer';
export interface Evidence { kind: EvidenceKind; ref: string }

export interface FlowStep { screenId: string; action: string; result: string }

export interface Flow {
  /** `F1`, `F2`, … Stable for the life of the run. */
  id: string;
  title: string;
  trigger: string;
  steps: FlowStep[];
  successState: string;
  failureStates: string[];
  evidence: Evidence[];
  status: ItemStatus;
  originalTitle?: string;
  editedAt?: number;
}

export interface Requirement {
  /** `R-001`, zero-padded. Never reused, never renumbered — an agent told to build R-012 must
   *  never find R-012 pointing at something else after a re-run. */
  id: string;
  title: string;
  statement: string;
  acceptanceCriteria: string[];
  priority: Priority;
  flowIds: string[];
  screenIds: string[];
  evidence: Evidence[];
  source: 'model' | 'human';
  status: ItemStatus;
  originalStatement?: string;
  editedAt?: number;
}

export interface RunLogEntry {
  at: number;
  stage: Stage;
  level: 'info' | 'warn' | 'error';
  message: string;
  /** Raw model output, kept when a stage failed to parse so the UI can show it. */
  raw?: string;
}

/** The heavy row. The run document IS the draft — there is no separate draft state. */
export interface SpecRunDoc {
  run: SpecRun;
  bundle: DesignBundle;
  spec: DesignSpec;
  flows: Flow[];
  requirements: Requirement[];
  questions: ClarifyQuestion[];
  answers: ClarifyAnswer[];
  log: RunLogEntry[];
}

export const emptySpec = (sourceFile = ''): DesignSpec => ({
  source_file: sourceFile,
  extracted_at: new Date(0).toISOString(),
  screens: [],
  design_tokens: { components: [] },
  unresolved_style_bindings: [],
  flagged_unreferenced_bindings: [],
});
