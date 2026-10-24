import type { Config } from 'tailwindcss';

// Every colour below is a var(--…) from src/styles/tokens.css, enumerated
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
      cv: {
        ground: v('cv-ground'),
        card: v('cv-card'), 'card-warm': v('cv-card-warm'), 'card-inset': v('cv-card-inset'),
        edge: v('cv-edge'), divider: v('cv-divider'), connector: v('cv-connector'),
        'hl-blue': v('cv-hl-blue'), 'hl-pink': v('cv-hl-pink'), 'hl-brown': v('cv-hl-brown'),
        'hl-green': v('cv-hl-green'), 'hl-yellow': v('cv-hl-yellow'), 'hl-orange': v('cv-hl-orange'),
        'island-memory': v('cv-island-memory'), 'island-rules': v('cv-island-rules'),
        'island-files': v('cv-island-files'), 'island-outputs': v('cv-island-outputs'),
      },
      sec: {
        notes: { DEFAULT: v('sec-notes'), soft: v('sec-notes-soft'), line: v('sec-notes-line') },
        artifacts: { DEFAULT: v('sec-artifacts'), soft: v('sec-artifacts-soft'), line: v('sec-artifacts-line') },
        files: { DEFAULT: v('sec-files'), soft: v('sec-files-soft'), line: v('sec-files-line') },
        canvas: { DEFAULT: v('sec-canvas'), soft: v('sec-canvas-soft'), line: v('sec-canvas-line') },
      },
      scrim: v('scrim'),
      annotate: { DEFAULT: v('annotate'), faint: v('annotate-faint'), soft: v('annotate-soft'), line: v('annotate-line') },
      success: v('success'),
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
