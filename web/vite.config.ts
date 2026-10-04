import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base '/web/' and the HMR clientPort are what let the app be served through
// the existing Python server on 127.0.0.1:8765 rather than from Vite's own
// origin. IndexedDB is origin-scoped, so developing on localhost:5173 would
// mean an empty database that looks like data loss. See the P3 plan.
export default defineConfig({
  base: '/web/',
  plugins: [react()],
  server: {
    // tokens.css is imported from ../frontend/styles, outside this project root.
    fs: { allow: ['..'] },
    // Explicit IPv4: the proxy in backend/app/dev_proxy.py dials 127.0.0.1, and
    // 'localhost' may resolve to ::1 only.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: { protocol: 'ws', host: '127.0.0.1', clientPort: Number(process.env.NOTLINEAR_PORT ?? 8765), path: '/web/@vite-hmr' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
