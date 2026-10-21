// The choices Settings offers. Ids and labels are copied from the legacy app
// and pinned to it by tests/settings/options-match-legacy.test.ts, because
// these ids are persisted in prefs and a typo here would silently save a model
// that legacy then cannot resolve.

export interface Choice { id: string; label: string; blurb: string }

export const THEMES: readonly Choice[] = [
  { id: 'dark', label: 'Dark', blurb: 'Black mono.' },
  { id: 'grey', label: 'Grey', blurb: 'Softer dark.' },
  { id: 'light', label: 'Light', blurb: 'Bright & clean.' },
];

export const TONES: readonly Choice[] = [
  { id: 'concise', label: 'Concise', blurb: 'Short, direct.' },
  { id: 'friendly', label: 'Friendly', blurb: 'Warm, casual.' },
  { id: 'formal', label: 'Formal', blurb: 'Precise, structured.' },
  { id: 'technical', label: 'Technical', blurb: 'Dense, exact.' },
  { id: 'socratic', label: 'Socratic', blurb: 'Question-led.' },
];

export const MODELS: readonly Choice[] = [
  { id: 'opus', label: 'Opus 5', blurb: 'Best reasoning.' },
  { id: 'opus-4-8', label: 'Opus 4.8', blurb: 'Previous gen.' },
  { id: 'opus-4-5', label: 'Opus 4.5', blurb: 'Older gen.' },
  { id: 'sonnet', label: 'Sonnet 5', blurb: 'Best balance.' },
  { id: 'sonnet-4-6', label: 'Sonnet 4.6', blurb: 'Previous gen.' },
  { id: 'sonnet-4-5', label: 'Sonnet 4.5', blurb: 'Older gen.' },
  { id: 'haiku', label: 'Haiku 4.5', blurb: 'Cheap, fast.' },
  { id: 'deepseek', label: 'DeepSeek Flash', blurb: 'Fast, cheap.' },
  { id: 'deepseek-pro', label: 'DeepSeek Pro', blurb: 'Stronger, pricier.' },
  { id: 'deepseek-r1', label: 'DeepSeek Thinking', blurb: 'Deep thinking.' },
  { id: 'gpt-4o', label: 'GPT-5.6 Terra', blurb: 'Balanced, general use.' },
  { id: 'gpt-4o-mini', label: 'GPT-5.6 Luna', blurb: 'Fast & cheap.' },
  { id: 'gpt-5', label: 'GPT-5', blurb: 'Legacy, retires Dec 2026.' },
  { id: 'gemini-flash', label: 'Gemini 2.0 Flash', blurb: 'Fast, multimodal.' },
  { id: 'gemini-pro', label: 'Gemini 2.5 Pro', blurb: 'Best reasoning.' },
];

export const RANKING_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'none', label: 'Keywords only (free, instant)' },
  { id: 'deepseek', label: 'DeepSeek — keyword gen + rerank (~$0.0003/query)' },
];

/** Providers a key can be connected for, in legacy's order (index.html #api-provider). */
export const PROVIDERS: readonly { id: string; label: string; option: string }[] = [
  { id: 'anthropic', label: 'Anthropic', option: 'Anthropic (Claude)' },
  { id: 'deepseek', label: 'DeepSeek', option: 'DeepSeek (branches + context ranking)' },
  { id: 'serper', label: 'Serper', option: 'Serper (Web Search)' },
  { id: 'firecrawl', label: 'Firecrawl', option: 'Firecrawl (Web Scrape)' },
  { id: 'github', label: 'GitHub', option: 'GitHub (repo & code research)' },
  { id: 'openai', label: 'OpenAI', option: 'OpenAI (GPT)' },
  { id: 'gemini', label: 'Gemini', option: 'Google (Gemini)' },
  { id: 'custom', label: 'Other', option: 'Other' },
];

/** app.js:4575 PROVIDER_LABELS; unknown providers display their own id. */
export function providerLabel(id: string): string {
  return PROVIDERS.find(p => p.id === id)?.label ?? id;
}
