import { defineConfig } from '@playwright/test';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPlaywrightOptions } = require('./tests/support/playwright-options.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { newRunId } = require('./tests/support/registry.cjs');

// 主程序與 worker 要共用同一個 runId：第一次載入時寫入環境變數。
// 注意：這裡不載入任何 .env 檔；DEV 變數由 globalSetup / start-test-server 經守衛後注入。
if (!process.env.TEST_RUN_ID) process.env.TEST_RUN_ID = newRunId();

export default defineConfig(
  buildPlaywrightOptions({
    root: path.resolve(__dirname),
    runId: process.env.TEST_RUN_ID as string,
  }),
);
