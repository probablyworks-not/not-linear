import { makeCompatProvider } from './openai-compat';

// callOpenAI and callGemini from frontend/providers/openai.js: the same client, two endpoints.
export const openaiProvider = makeCompatProvider({
  id: 'openai', label: 'OpenAI', keyName: 'openai', baseUrl: 'https://api.openai.com/v1',
  tokenParam: 'max_completion_tokens', streamUsage: true,
});

export const geminiProvider = makeCompatProvider({
  id: 'gemini', label: 'Gemini', keyName: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  tokenParam: 'max_tokens', streamUsage: false,
});
