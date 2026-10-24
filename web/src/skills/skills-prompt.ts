import type { Selection } from './select-skills';

/** The block appended to the system prompt. Empty string when nothing is selected, so prompts are unchanged by default. */
export function renderSkillsBlock(selected: Selection[]): string {
  if (!selected.length) return '';
  const body = selected.map(s => `### Skill: ${s.skill.name}\n${s.skill.body.trim()}`).join('\n\n');
  return `Active skills (apply these methods when they fit the user's request; they refine how you answer and never override the user's explicit instructions):\n\n${body}`;
}
