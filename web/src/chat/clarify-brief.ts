import type { ContextFile } from '../attachments/attachment-context';
import type { PersistedProject } from '../db/types';

// What the clarify pre-pass (clarify.ts) is told about the project before it decides whether a
// message is ambiguous. The real reply gets the whole system prompt, project files and all; the
// clarify pass gets this short, hard-capped digest instead, because a blind clarify pass asks
// questions the project has already answered ("what kind of product is this?").
//
// Deliberately NOT buildAttachmentContext: its limits are 30k per file and 70k in total, which is
// the budget of the answer, not of a yes/no ambiguity check. The wording here is prompt text.

const RULES_CHARS = 1500;
const FILE_CHARS = 400;
const QUOTE_CHARS = 600;
const MAX_FILES = 6;
const MAX_SOURCES = 20;
export const CLARIFY_BRIEF_CHARS = 4000;

/** Same marker as attachment-context, so a cut looks the same wherever the model meets one. */
function clip(text: string, limit: number): string {
  const t = text.trim();
  return t.length > limit ? `${t.slice(0, limit)}\n[truncated]` : t;
}

export interface ClarifyBriefInput {
  project?: PersistedProject;
  /** Paths of the linked-folder files ranked relevant to this message (Turn.sources.names). */
  folderSources?: readonly string[];
  /** Names of the files attached to this message; their contents are not included. */
  fileNames?: readonly string[];
  /** The passage the user highlighted to open this branch (and any ancestor branches' passages). Scopes the question hugely: a branch asking about a highlighted passage is rarely ambiguous. */
  quote?: string;
}

/** The project digest prefixed to the clarify request. Empty when there is nothing to say. */
export function buildClarifyBrief({ project, folderSources = [], fileNames = [], quote }: ClarifyBriefInput): string {
  const parts: string[] = [];
  if (quote && quote.trim()) {
    parts.push(`The user highlighted this passage and is asking about it specifically — it already scopes the question, do not ask what it's about or which part they mean:\n"${clip(quote, QUOTE_CHARS)}"`);
  }
  if (project) {
    parts.push(`Project: ${project.name}`);
    if (project.rules && project.rules.trim()) {
      parts.push(`Project rules:\n${clip(project.rules, RULES_CHARS)}`);
    }
    const files = (project.files || []).filter(Boolean) as ContextFile[];
    const lines = files
      .slice(0, MAX_FILES)
      .map(f => `- ${f.name}: ${f.content ? clip(f.content, FILE_CHARS) : '(no readable text)'}`);
    if (lines.length) parts.push(`Project knowledge files:\n${lines.join('\n')}`);
  }
  if (folderSources.length) {
    parts.push(`Linked project files relevant to this message: ${folderSources.slice(0, MAX_SOURCES).join(', ')}`);
  }
  if (fileNames.length) {
    parts.push(`Files attached to this message: ${fileNames.join(', ')}`);
  }
  if (!parts.length) return '';
  const head = 'Project context (what the user has already told this app about their work — treat as settled fact):';
  return clip(`${head}\n${parts.join('\n')}`, CLARIFY_BRIEF_CHARS);
}
