import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base '/web/' and the HMR clientPort are what let the app be served through
// the existing Python server on 127.0.0.1:8765 rather than from Vite's own
// origin. IndexedDB is origin-scoped, so developing on localhost:5173 would
// mean an empty database that looks like data loss. See the P3 plan.
export default defineConfig({
  base: '/web/',
  plugins: [react()],
  // The bundled skills library's SKILL.md files (imported via import.meta.glob
  // with query: '?raw' in web/src/skills/builtin.ts) live outside this project
  // root. For out-of-root files the dev server's raw-query detection can miss,
  // so force .md to be treated as a static asset regardless of query string.
  assetsInclude: ['**/*.md'],
  server: {
    // The bundled skills library (../notlinear-skills) lives outside this project root.
    fs: { allow: [".."] },
    // Explicit IPv4: the proxy in backend/app/dev_proxy.py dials 127.0.0.1, and
    // 'localhost' may resolve to ::1 only.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: { protocol: 'ws', host: '127.0.0.1', clientPort: Number(process.env.NOTLINEAR_PORT ?? 8765), path: '/web/@vite-hmr' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
