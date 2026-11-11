import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from './playwright.config';

const app = process.env.NOTLINEAR_TEST_APP;
if (!app) throw new Error('Set NOTLINEAR_TEST_APP to the actual built .app');
const resources = resolve(app, 'Contents/Resources');
const python = resolve(resources, 'python/bin/python3');
const backend = resolve(resources, 'app/backend/server.py');
const data = `/tmp/notlinear-packaged-e2e-${process.pid}`;
export default defineConfig({
  ...base,
  outputDir: 'test-results/package',
  webServer: {
    command: `"${python}" -I -B "${backend}" --port 8766`,
    cwd: '..',
    env: {
      NOTLINEAR_FAKE_NATIVE: '1', NOTLINEAR_DEV_PROXY: '0',
      NOTLINEAR_DATA_DIR: data, NOTLINEAR_BACKUP_DIR: `${data}/backups`,
      NOTLINEAR_CONSENT_DIR: `${data}/consent`, NOTLINEAR_AGENT_HOME: `${data}/agents`,
      NOTLINEAR_AGENT_PYTHON: python, NOTLINEAR_CLAUDE_CLI: resolve(resources, 'python/agent-claude'),
      CLAUDE_CONFIG_DIR: `${data}/claude`,
    },
    url: 'http://127.0.0.1:8766/web/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
