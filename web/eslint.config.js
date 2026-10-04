import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// A colour literal anywhere under src/ is a bug waiting for a theme switch
// (bug #022). Tokens come from frontend/styles/tokens.css via tailwind.config.ts;
// the only legal colour spelling in components is a Tailwind class or var(--…).
const NO_LITERAL_COLOUR = [
  {
    selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
    message: 'No literal hex colours. Use a Tailwind token class or var(--…) from tokens.css.',
  },
  {
    selector: "Literal[value=/\\b(?:rgba?|hsla?)\\(/]",
    message: 'No literal rgb()/hsl() colours. Use a Tailwind token class or var(--…) from tokens.css.',
  },
  {
    selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?)\\(/]",
    message: 'No literal colours in template strings. Use a token.',
  },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-syntax': ['error', ...NO_LITERAL_COLOUR],
      // CLAUDE.md: no `any` without a reason comment on the same line.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
