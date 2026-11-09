import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { BASE_URL } from './support';

// 巡店定位例外：integration（資料庫 trigger，不開瀏覽器）與 e2e（桌機 1920x1080）。一律單一 worker 依序執行。
const outDir = process.env.GPSEX_OUT_DIR || path.resolve(__dirname, '.results');
export default defineConfig({
  testDir: __dirname,
  testMatch: /(integration|e2e)\/.*\.spec\.ts$/,
  outputDir: path.join(outDir, 'test-results'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['json', { outputFile: path.join(outDir, 'report.json') }]],
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  projects: [
    { name: 'integration', testMatch: /integration\/.*\.spec\.ts$/ },
    { name: 'e2e', testMatch: /e2e\/.*\.spec\.ts$/, use: { baseURL: BASE_URL, viewport: { width: 1920, height: 1080 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' }, dependencies: ['integration'] },
  ],
});
