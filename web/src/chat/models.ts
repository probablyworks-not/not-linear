import type { ProviderId } from '../providers/types';

// Ported from providers/tools.js providerForModelPref / modelIdForModelPref and
// claude.js's thinking gate. Pref ids are persisted, so they are never renamed.

export type ModelPlan =
  | { supported: true; provider: ProviderId; modelId: string; thinking: boolean; usageProvider: 'anthropic' | 'deepseek' }
  | { supported: false; reason: string };

const CLAUDE_IDS: Record<string, string> = {
  opus: 'claude-opus-5',
  'opus-4-8': 'claude-opus-4-8',
  'opus-4-5': 'claude-opus-4-5',
  'sonnet-4-6': 'claude-sonnet-4-6',
  'sonnet-4-5': 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5-20251001',
};
const CLAUDE_THINKING = new Set(['opus', 'sonnet', 'opus-4-8', 'sonnet-4-6']);
const OTHER_PROVIDER = /^(gpt-|gemini-)/;

/** The model the composer falls back to, as in core/state.js. */
export const DEFAULT_MODEL_PREF = 'sonnet';

export function planModel(pref: string | undefined, thinkingPref: boolean): ModelPlan {
  const p = pref || DEFAULT_MODEL_PREF;
  if (p === 'deepseek' || p === 'deepseek-r1') {
    return { supported: true, provider: 'deepseek', modelId: 'deepseek-v4-flash', thinking: p === 'deepseek-r1', usageProvider: 'deepseek' };
  }
  if (OTHER_PROVIDER.test(p)) {
    return { supported: false, reason: 'This model opens in the classic app until its provider moves over. Pick a Claude or DeepSeek model in Settings.' };
  }
  return {
    supported: true,
    provider: 'claude',
    modelId: CLAUDE_IDS[p] ?? 'claude-sonnet-5',
    thinking: thinkingPref && CLAUDE_THINKING.has(p),
    usageProvider: 'anthropic',
  };
}

/** The model's display name (providers/tools.js modelLabelFromId), shown in a reply's usage line. */
export function modelLabelFromId(id: string | undefined, thinking = false): string {
  const model = String(id || '');
  if (model.includes('haiku')) return 'Claude Haiku 4.5';
  if (model === 'claude-opus-4-8') return 'Claude Opus 4.8';
  if (model === 'claude-opus-4-5') return 'Claude Opus 4.5';
  if (model.includes('opus')) return 'Claude Opus 5';
  if (model === 'claude-sonnet-4-6') return 'Claude Sonnet 4.6';
  if (model === 'claude-sonnet-4-5') return 'Claude Sonnet 4.5';
  if (model.includes('sonnet')) return 'Claude Sonnet 5';
  if (model === 'deepseek-v4-flash') return thinking ? 'DeepSeek Flash (Thinking)' : 'DeepSeek Flash';
  if (model === 'deepseek-v4-pro') return 'DeepSeek Pro';
  if (model === 'gpt-5.6-luna') return 'GPT-5.6 Luna';
  if (model === 'gpt-5.6-terra') return 'GPT-5.6 Terra';
  if (model === 'gpt-5.6-sol') return 'GPT-5.6 Sol';
  if (model === 'gpt-5-2025-08-07') return 'GPT-5';
  if (model.includes('gemini-2.0-flash')) return 'Gemini 2.0 Flash';
  if (model.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro';
  return model;
}
