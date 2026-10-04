import type { Config } from 'tailwindcss';

// Every colour below is a var(--…) from frontend/styles/tokens.css, enumerated
// from that file rather than invented. Components never branch on theme: the
// token value changes under html[data-theme], the class stays the same. There
// is deliberately no literal colour in this file or anywhere under web/src
// (eslint.config.js enforces it) — hardcoding one was the root cause of bug #022.
const v = (name: string) => `var(--${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Replace, not extend: the stock palette is full of literal hex values and
    // having `bg-red-500` available is how off-token colour creeps back in.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      bg: { DEFAULT: v('bg'), 2: v('bg-2'), 3: v('bg-3') },
      surface: { DEFAULT: v('surface'), 2: v('surface-2'), tint: v('surface-tint') },
      rule: { DEFAULT: v('rule'), 2: v('rule-2') },
      text: { DEFAULT: v('text'), 2: v('text-2'), 3: v('text-3') },
      accent: { DEFAULT: v('accent'), 2: v('accent-2'), soft: v('accent-soft') },
      branch: { DEFAULT: v('branch'), soft: v('branch-soft'), strong: v('branch-strong') },
      highlight: { DEFAULT: v('highlight'), soft: v('highlight-soft'), strong: v('highlight-strong') },
      danger: { DEFAULT: v('danger'), soft: v('danger-soft'), strong: v('danger-strong'), border: v('danger-border'), on: v('on-danger') },
      scrim: v('scrim'),
      user: v('user-bub'),
      th: v('th-tint'),
      kbd: { bg: v('kbd-bg'), fg: v('kbd-color') },
      scrollbar: v('scrollbar-thumb'),
      syn: {
        keyword: v('syn-keyword'),
        string: v('syn-string'),
        number: v('syn-number'),
        comment: v('syn-comment'),
        function: v('syn-function'),
        tag: v('syn-tag'),
        attr: v('syn-attr'),
      },
    },
    fontFamily: { sans: v('font'), mono: v('mono') },
    // CLAUDE.md: type sizes are 12 / 13 / 14px — anything else is wrong.
    fontSize: { xs: '12px', sm: '13px', base: '14px' },
    boxShadow: { md: v('shadow-md'), lg: v('shadow-lg'), none: 'none' },
    extend: {
      width: { sidebar: v('sidebar-w') },
      spacing: { sidebar: v('sidebar-w') },
    },
  },
  plugins: [],
} satisfies Config;
