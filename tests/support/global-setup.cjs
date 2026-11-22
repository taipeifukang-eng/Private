'use strict';
/**
 * Playwright globalSetup：先過環境守衛，再 preflight 測試站（/api/workspace/session 不得為 503）。
 * 失敗時丟錯（Playwright 會中止整個 run）；訊息不含祕密。
 */
const fs = require('node:fs');
const path = require('node:path');
const { assertDevEnvironment, applyDevEnv, preflightServer } = require('./env-guard.cjs');
const { TEST_SITE_ORIGIN } = require('./env-refs.cjs');

module.exports = async function globalSetup() {
  const root = path.resolve(__dirname, '..', '..');
  const { env, summary } = assertDevEnvironment({ root });
  // 注入給 worker（測試內的 service role 回讀使用），只來自 .env.development.local。
  applyDevEnv(env);
  const pre = await preflightServer(TEST_SITE_ORIGIN);

  const runId = process.env.TEST_RUN_ID;
  if (runId) {
    const dir = path.join(root, 'tests', 'reports', runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'guard.json'),
      JSON.stringify(
        { passed: true, projectRef: summary.projectRef, serverStatus: pre.status, at: new Date().toISOString() },
        null,
        2,
      ),
    );
  }
};
