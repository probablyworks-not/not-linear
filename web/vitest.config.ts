import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // jsdom: the app and its tests touch document and window.
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Legacy-parity tests need the (private, gitignored) frontend/ tree. Run them with `pnpm test:oracle`.
    exclude: ['tests/legacy-oracle/**', 'node_modules/**'],
  },
});
