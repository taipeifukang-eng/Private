'use strict';
/**
 * Playwright 設定的純函式建構器（可在 Vitest 中以假參數測試）。
 * 規則：chromium、desktop-1440 與 mobile-390 兩個 project（D16）、workers=1（DEV 共享）、
 * webServer 依 D10：已在執行就沿用，否則 build + 同步 + integrated 啟動，測完由 Playwright 關閉。
 */
const path = require('node:path');
const { TEST_SITE_ORIGIN } = require('./env-refs.cjs');

const SESSION_URL = `${TEST_SITE_ORIGIN}/api/workspace/session`;

function buildPlaywrightOptions({ root, runId, nodeBin = process.execPath } = {}) {
  if (!root) throw new Error('root 為必填');
  if (!runId) throw new Error('runId 為必填');
  const reportDir = path.join(root, 'tests', 'reports', runId);
  return {
    testDir: path.join(root, 'tests'),
    // 只收 *.spec.ts；Vitest 的 *.test.ts 不會被 Playwright 撿到。
    testMatch: ['**/*.spec.ts'],
    outputDir: path.join(reportDir, 'test-results'),
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: true,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [
      ['list'],
      ['html', { outputFolder: path.join(reportDir, 'playwright-report'), open: 'never' }],
      ['junit', { outputFile: path.join(reportDir, 'junit-playwright.xml') }],
      ['json', { outputFile: path.join(reportDir, 'playwright-results.json') }],
    ],
    globalSetup: path.join(root, 'tests', 'support', 'global-setup.cjs'),
    globalTeardown: path.join(root, 'tests', 'support', 'global-teardown.cjs'),
    use: {
      baseURL: TEST_SITE_ORIGIN,
      browserName: 'chromium',
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
      // 注意：寫入 API 要求 Origin 為 http://localhost:3002，一律用 localhost（baseURL）而非 127.0.0.1。
    },
    projects: [
      {
        // 桌機：所有層（smoke / integration / e2e / parity）
        name: 'desktop-1440',
        use: { viewport: { width: 1440, height: 900 } },
      },
      {
        // 手機：只跑會開瀏覽器的層，避免 API 測試重複執行
        name: 'mobile-390',
        testMatch: ['**/smoke/**/*.spec.ts', '**/e2e/**/*.spec.ts'],
        use: {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        },
      },
    ],
    webServer: {
      command: `"${nodeBin}" tests/support/start-test-server.cjs`,
      cwd: root,
      url: SESSION_URL,
      // 已在執行就沿用（globalSetup 會再 preflight：503 即中止）
      reuseExistingServer: true,
      timeout: 600_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  };
}

module.exports = { buildPlaywrightOptions, SESSION_URL };
