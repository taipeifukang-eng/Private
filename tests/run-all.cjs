'use strict';
/**
 * 統一 runner。
 *   node tests/run-all.cjs [--layers unit,smoke,integration,e2e,parity|all] [--page <workId>]
 *                          [--run-id <id>] [--enforce-fix <Wxx[,Wyy]|all>] [--no-sweep] [--allow-nonempty-reserved]
 * 步驟：守衛 -> (瀏覽器層) 確認測試站 -> sweeper(pre) -> unit -> playwright 各層 -> sweeper(post) -> 彙總。
 * 輸出：tests/reports/<runId>/summary.json、junit.xml、playwright-report/、created.json…
 * exit code：0 全綠；1 有測試失敗；2 環境守衛／測試站未通過；3 保留月份出現非測試門市資料而中止。
 */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertDevEnvironment, applyDevEnv, preflightServer } = require('./support/env-guard.cjs');
const { TEST_SITE_ORIGIN } = require('./support/env-refs.cjs');
const { newRunId, RUN_ID_RE } = require('./support/registry.cjs');

const ROOT = path.resolve(__dirname, '..');
const ALL_LAYERS = ['unit', 'smoke', 'integration', 'e2e', 'parity'];
const PLAYWRIGHT_LAYERS = ['smoke', 'integration', 'e2e', 'parity'];

function parseArgs(argv) {
  const opts = { layers: ALL_LAYERS.slice(), page: null, runId: null, enforceFix: null, sweep: true, allowNonEmptyReserved: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--layers') {
      const v = argv[(i += 1)] || '';
      opts.layers = v === 'all' ? ALL_LAYERS.slice() : v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--page') opts.page = argv[(i += 1)] || null;
    else if (a === '--run-id') opts.runId = argv[(i += 1)] || null;
    else if (a === '--enforce-fix') opts.enforceFix = argv[(i += 1)] || null;
    else if (a === '--no-sweep') opts.sweep = false;
    else if (a === '--allow-nonempty-reserved') opts.allowNonEmptyReserved = true;
    else if (!a.startsWith('--') && !opts.page) opts.page = a; // npm run test:page -- W06
    else throw new Error(`未知參數：${a}`);
  }
  const bad = opts.layers.filter((l) => !ALL_LAYERS.includes(l));
  if (bad.length) throw new Error(`未知的測試層：${bad.join(',')}`);
  if (opts.page && !/^[A-Za-z0-9_-]+$/.test(opts.page)) throw new Error('工作項 ID 格式不正確');
  if (opts.enforceFix !== null && !/^(all|[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*)$/.test(opts.enforceFix)) throw new Error('--enforce-fix 格式不正確（Wxx[,Wyy] 或 all）');
  if (opts.runId && !RUN_ID_RE.test(opts.runId)) throw new Error('runId 格式不正確');
  return opts;
}

/** 決定 PARITY_ENFORCE_FIX：--enforce-fix 優先；否則 --page <id> 自動帶入；否則沿用呼叫端環境變數。 */
function resolveEnforceFix(opts, inherited) {
  if (opts.enforceFix) return opts.enforceFix;
  if (opts.page) return opts.page;
  return inherited || '';
}

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(1500);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function runNode(args, extraEnv = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return { status: r.status === null ? 1 : r.status, ms: Date.now() - started };
}

function emptyLayer(status = 'skipped') {
  return { status, pass: 0, fail: 0, skip: 0, durationMs: 0 };
}

function collectPlaywrightCounts(json) {
  const layers = {};
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      const layer = String(spec.file || suite.file || '').replace(/\\/g, '/').split('/')[0];
      if (!PLAYWRIGHT_LAYERS.includes(layer)) continue;
      const l = (layers[layer] = layers[layer] || emptyLayer('ran'));
      for (const t of spec.tests || []) {
        if (t.status === 'unexpected') l.fail += 1;
        else if (t.status === 'skipped') l.skip += 1;
        else l.pass += 1;
        for (const r of t.results || []) l.durationMs += r.duration || 0;
      }
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const s of (json && json.suites) || []) walk(s);
  return layers;
}

function mergeJUnit(reportDir) {
  const parts = ['junit-vitest.xml', 'junit-playwright.xml']
    .map((f) => path.join(reportDir, f))
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8').replace(/<\?xml[^>]*\?>/, '').trim())
    .map((x) => x.replace(/^<testsuites[^>]*>/, '').replace(/<\/testsuites>\s*$/, ''));
  fs.writeFileSync(
    path.join(reportDir, 'junit.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${parts.join('\n')}\n</testsuites>\n`,
  );
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[run-all] ${error.message}`);
    process.exit(1);
  }
  const runId = opts.runId || newRunId();
  const reportDir = path.join(ROOT, 'tests', 'reports', runId);
  fs.mkdirSync(reportDir, { recursive: true });

  const startedAt = new Date();
  const summary = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: 0,
    page: opts.page,
    layersRequested: opts.layers,
    guard: { passed: false },
    server: null,
    sweeper: {},
    layers: {},
    totals: { pass: 0, fail: 0, skip: 0 },
    exitCode: 0,
    reportDir: path.relative(ROOT, reportDir).replace(/\\/g, '/'),
  };
  const finish = (code, reason) => {
    summary.exitCode = code;
    if (reason) summary.abortReason = reason;
    for (const l of Object.values(summary.layers)) {
      summary.totals.pass += l.pass; summary.totals.fail += l.fail; summary.totals.skip += l.skip;
    }
    summary.finishedAt = new Date().toISOString();
    summary.durationMs = Date.now() - startedAt.getTime();
    fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
    try { mergeJUnit(reportDir); } catch { /* 沒有 junit 輸出時略過 */ }
    console.log(`\n[run-all] runId=${runId} exit=${code} summary=${summary.reportDir}/summary.json`);
    process.exit(code);
  };

  // 1) 守衛（任何層都先跑）
  let devEnv;
  try {
    const g = assertDevEnvironment({ root: ROOT });
    devEnv = g.env;
    summary.guard = { passed: true, projectRef: g.summary.projectRef };
    console.log(`[run-all] 環境守衛通過（ref ${g.summary.projectRef}）`);
  } catch (error) {
    console.error(`[run-all] 環境守衛未通過：${error.message}`);
    return finish(2, 'guard');
  }
  // 子程序（vitest / playwright / sweeper）只繼承 DEV 變數
  applyDevEnv(devEnv);
  process.env.TEST_RUN_ID = runId;
  // decision:"fix" 的白名單差異：test:page -- <id> 自動強制該工作項；--enforce-fix 可明確指定（all = 最終回歸 F01）。
  const enforceFix = resolveEnforceFix(opts, process.env.PARITY_ENFORCE_FIX);
  if (enforceFix) process.env.PARITY_ENFORCE_FIX = enforceFix;
  else delete process.env.PARITY_ENFORCE_FIX;
  summary.enforceFix = enforceFix || null;

  const pwLayers = opts.layers.filter((l) => PLAYWRIGHT_LAYERS.includes(l));
  const needsDb = pwLayers.length > 0;

  // 2) 測試站已在執行時先 preflight（503 即中止）；未執行則交給 Playwright webServer 啟動
  if (pwLayers.length) {
    if (await isPortOpen(3002)) {
      try {
        const r = await preflightServer(TEST_SITE_ORIGIN);
        summary.server = { reused: true, sessionStatus: r.status };
        console.log(`[run-all] 3002 已在執行，沿用（session HTTP ${r.status}）`);
      } catch (error) {
        console.error(`[run-all] 測試站 preflight 失敗：${error.message}`);
        return finish(2, 'server-preflight');
      }
    } else {
      summary.server = { reused: false };
      console.log('[run-all] 3002 未執行：Playwright 將 build、同步並以 integrated 模式啟動，測完關閉');
    }
  }

  // 3) sweeper(pre)
  const { runSweeper } = require('./support/sweeper.cjs');
  if (needsDb && opts.sweep) {
    try {
      const pre = await runSweeper({ root: ROOT, mode: 'sweep', phase: 'pre' });
      fs.writeFileSync(path.join(reportDir, 'sweeper-pre.json'), JSON.stringify(pre, null, 2));
      summary.sweeper.pre = { orphanCount: pre.orphanCount, errors: pre.errors.length, reservedMonthsDeleted: pre.reservedMonthsDeleted, reservedMonthsForeign: pre.reservedMonthsForeign };
      console.log(`[run-all] sweeper(pre)：孤兒 ${pre.orphanCount}，清除保留月份測試門市資料 ${pre.reservedMonthsDeleted} 筆`);
      if (pre.reservedMonthsNonEmpty && !opts.allowNonEmptyReserved) {
        console.error('[run-all] 保留月份 2099-xx 出現非測試門市資料，中止且未刪除：');
        for (const f of pre.reservedMonthsForeign) console.error(`  ${f.table}: ${f.rows} 筆`);
        return finish(3, 'reserved-months-not-empty');
      }
    } catch (error) {
      console.error(`[run-all] sweeper(pre) 失敗：${String(error.message).slice(0, 200)}`);
      return finish(error.exitCode || 1, 'sweeper-pre');
    }
  }

  let failed = false;

  // 4) unit
  if (opts.layers.includes('unit')) {
    const vitestBin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const args = [
      vitestBin, 'run', '--passWithNoTests',
      '--reporter=default', '--reporter=junit', '--reporter=json',
      `--outputFile.junit=${path.join(reportDir, 'junit-vitest.xml')}`,
      `--outputFile.json=${path.join(reportDir, 'vitest-results.json')}`,
    ];
    if (opts.page) args.push(`tests/unit/${opts.page}/`);
    const r = runNode(args);
    const j = readJson(path.join(reportDir, 'vitest-results.json'));
    summary.layers.unit = {
      status: r.status === 0 ? 'passed' : 'failed',
      pass: j ? j.numPassedTests || 0 : 0,
      fail: j ? j.numFailedTests || 0 : 0,
      skip: j ? (j.numPendingTests || 0) + (j.numTodoTests || 0) : 0,
      durationMs: r.ms,
    };
    if (r.status !== 0) failed = true;
  }

  // 5) Playwright（一次跑完所有選到的層，webServer 只啟停一次）
  if (pwLayers.length) {
    const cli = require.resolve('@playwright/test/cli');
    const filters = pwLayers.map((l) => (opts.page ? `[\\\\/]${l}[\\\\/]${opts.page}[.]` : `[\\\\/]${l}[\\\\/]`));
    const r = runNode([cli, 'test', '--pass-with-no-tests', ...filters], { TEST_RUN_ID: runId });
    const counts = collectPlaywrightCounts(readJson(path.join(reportDir, 'playwright-results.json')));
    for (const layer of pwLayers) {
      const c = counts[layer] || emptyLayer('ran');
      c.status = c.fail > 0 ? 'failed' : c.pass + c.skip === 0 ? 'no-tests' : 'passed';
      summary.layers[layer] = c;
    }
    if (r.status !== 0) {
      failed = true;
      // 沒有任何測試失敗卻非 0（例如 globalSetup / webServer 失敗）
      if (!Object.values(summary.layers).some((l) => l.fail > 0)) summary.playwrightError = `exit ${r.status}`;
    }
  }

  // 6) sweeper(post)
  if (needsDb && opts.sweep) {
    try {
      const post = await runSweeper({ root: ROOT, mode: 'sweep', phase: 'post' });
      fs.writeFileSync(path.join(reportDir, 'sweeper-post.json'), JSON.stringify(post, null, 2));
      summary.sweeper.post = { orphanCount: post.orphanCount, errors: post.errors.length, reservedMonthsDeleted: post.reservedMonthsDeleted, reservedMonthsForeign: post.reservedMonthsForeign };
      console.log(`[run-all] sweeper(post)：孤兒 ${post.orphanCount}，清除保留月份測試門市資料 ${post.reservedMonthsDeleted} 筆`);
      if (post.orphanCount > 0) failed = true;
      if (post.reservedMonthsNonEmpty && !opts.allowNonEmptyReserved) failed = true;
    } catch (error) {
      console.error(`[run-all] sweeper(post) 失敗：${String(error.message).slice(0, 200)}`);
      summary.sweeper.post = { error: true };
      failed = true;
    }
  }

  finish(failed ? 1 : 0);
}

module.exports = { parseArgs, resolveEnforceFix, collectPlaywrightCounts, ALL_LAYERS, PLAYWRIGHT_LAYERS };

if (require.main === module) {
  main().catch((error) => {
    console.error(`[run-all] 未預期的錯誤：${String(error.message).slice(0, 300)}`);
    process.exit(1);
  });
}
