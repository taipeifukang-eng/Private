import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { BASE_URL } from './support';

// 處方箋 Google Sheet 匯入：API 整合與桌機（1920x1080）e2e，單一 worker 依序執行。
const outDir = process.env.RXGS_OUT_DIR || path.resolve(__dirname, '.results');
export default defineConfig({
  testDir: __dirname,
  testMatch: /e2e\/.*\.spec\.ts$/,
  outputDir: path.join(outDir, 'test-results'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: { baseURL: BASE_URL, viewport: { width: 1920, height: 1080 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' },
});
