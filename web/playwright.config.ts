import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the LEGACY app (frontend/index.html), not the
// new web/ one. That is the point: they capture current behaviour now, while
// the legacy app is the only implementation, so every later phase has a
// regression oracle instead of a human clicking through ten steps.
//
// Port 8766, not the usual 8765, so a running copy of the app is not disturbed
// and a developer's session is not competing with the suite for the port.
const PORT = 8766;
const HOST = '127.0.0.1';

export default defineConfig({
  testDir: './tests/e2e',
  // The fragile areas (BUGS #002-#018) are state bugs. Retrying them would
  // mask exactly the flakiness worth seeing, so retries stay off locally and
  // are kept to one in CI only for genuine infrastructure noise.
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one server, one IndexedDB origin — parallel runs would collide
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    // 127.0.0.1, never localhost: they are different origins with different
    // IndexedDB contents, which is the same trap the P-1 backup tools warn
    // about.
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `python3 backend/server.py --host ${HOST} --port ${PORT}`,
    cwd: '..',
    // Stubs osascript and screencapture (backend/app/services/macos.py). Without this, a test
    // that clicks "Add files" would put a REAL macOS file dialog on the developer's screen and
    // hang waiting for it. With it, the native pickers report "cancelled", which is exactly the
    // path that must fall through to the browser's own file input (BUGS.md #022).
    env: { NOTLINEAR_FAKE_NATIVE: '1' },
    url: `http://${HOST}:${PORT}/frontend/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
