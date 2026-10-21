import { defineConfig } from 'vitest/config';

// Local-only: legacy-parity tests that read the gitignored frontend/ tree.
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/legacy-oracle/**/*.test.ts'],
  },
});
