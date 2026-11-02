'use strict';
/**
 * Playwright globalTeardown：清除本次 run 自己登錄在 created.json 的單次資料。
 * 沒有登錄項目時不連 DB。伺服器由 Playwright webServer 關閉（只關自己啟動的）。
 */
const path = require('node:path');
const { readCreated, RUN_ID_RE } = require('./registry.cjs');

module.exports = async function globalTeardown() {
  const runId = process.env.TEST_RUN_ID;
  if (!runId || !RUN_ID_RE.test(runId)) return;
  const root = path.resolve(__dirname, '..', '..');
  const created = readCreated(path.join(root, 'tests', 'reports', runId, 'created.json'));
  if (!created || !created.entries.some((e) => e.status === 'pending' || e.status === 'failed')) return;
  const { runSweeper } = require('./sweeper.cjs');
  const result = await runSweeper({ root, mode: 'sweep', phase: 'teardown' });
  if (result.orphanCount > 0) {
    console.warn(`[sweeper] teardown 後仍有 ${result.orphanCount} 筆孤兒資料，請查看 tests/reports`);
  }
};
