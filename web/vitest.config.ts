import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // jsdom, because the schema oracle imports the real frontend/core/store.js,
    // whose persistAll() reads sidebar state via document.querySelectorAll.
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
