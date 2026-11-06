#!/usr/bin/env node
'use strict';
/**
 * 每月人員狀態加速：改前／改後結果一致性測試（DEV 整合測試）。
 *
 * 做法：用 ms-harness 把「改前版本」（預設 = origin/main 與目前分支的 merge-base）與「工作樹版本」的
 * app/store/actions.ts 各載入一份，對同一組 DEV 測試帳號（管理員、店長、督導、一般員工、各單一權限、
 * 角色過期 / 停用等邊界）呼叫同樣的 server action，逐項比對回傳值必須完全相同：
 *
 *   A2  checkMonthlyStatusPermissions：12 個旗標 + success/error 逐一相同
 *       getUserManagedStores（含 include_inactive）：success / error / role / department / job_title / 可管門市清單（含順序與全部欄位）相同
 *   A3  getMonthlyStoreSummaries：success / 列數 / 列順序 / 每列所有欄位相同；
 *       store 關聯物件只比對明確欄位（頁面不使用該關聯）
 *   A1  getMonthlyStaffStatus：整個回傳（含上月單品獎金、加盟店業績扣除後的業績欄位）相同
 *   A4  getStoreMonthlySummary 回傳相同（A4 頁面層另以瀏覽器畫面快照比對）
 *
 * 並列出每個 action 的往返次數（改前 vs 改後）。任何不一致 → exit code 1。
 *
 * 「改前」參考值的資料庫端語意 = 正式區 has_permission（與 DEV 的 has_permission 不同）：
 * 測試開始時在 DEV 建立暫時函式 perf_has_permission_prod（內容同正式區定義），改前版本的 rpc('has_permission')
 * 被 harness 攔截改呼叫它；測完（含失敗）一律 DROP。
 *
 * 用法：node scripts/perf/test-monthly-status-equivalence.cjs [--base <git ref>] [--only key1,key2] [--keep]
 * 只連 DEV；測試資料用完即清除（--cleanup 可單獨清除殘留）。
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadDevEnv, ROOT } = require('./dev-env.cjs');
const { setup, teardown, cleanupAll, buildScenarios, YM, FRANCHISE_STORE } = require('./ms-fixture.cjs');
const { openActions, makeServiceClient } = require('./ms-harness.cjs');
const prodFn = require('./prod-has-permission-fn.cjs');

const ARGS = process.argv.slice(2);
const argVal = (n, d) => {
  const i = ARGS.indexOf(n);
  return i >= 0 ? ARGS[i + 1] : d;
};
process.chdir(ROOT);
const ENV = loadDevEnv();
const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));

function resolveBase() {
  const given = argVal('--base', null);
  if (given) return given;
  try {
    return execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'HEAD';
  }
}
const BASE = resolveBase();
const NEW = 'worktree';
const STORE_FIELDS = ['id', 'store_code', 'store_name', 'is_active', 'is_franchise'];
const FLAGS = [
  'canViewStats', 'canViewSupportHours', 'canEditSupportHours', 'canEditSupportBonus', 'canAddEmployee',
  'canAccessActivityManagement', 'canViewPerformance', 'canViewMonthlyBonusDetail', 'canConfirmStatus',
  'canRevertStatus', 'canUnconfirmStatus', 'canExportMonthlyDownload',
];

// 安靜：action 內有大量 console.log / error
const realLog = console.log;
const realErr = console.error;
const say = (...a) => realLog(...a);
function quiet() {
  console.log = () => {};
  console.error = () => {};
}
function loud() {
  console.log = realLog;
  console.error = realErr;
}

let failures = 0;
let checks = 0;
const failLines = [];
function stable(v) {
  return JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1))) : val));
}
function same(label, a, b) {
  checks += 1;
  const sa = stable(a);
  const sb = stable(b);
  if (sa !== sb) {
    failures += 1;
    failLines.push(`不一致 ${label}\n   改前: ${sa.slice(0, 400)}\n   改後: ${sb.slice(0, 400)}`);
    return false;
  }
  return true;
}

function pickStores(res) {
  return res;
}
function normalizeSummaries(res) {
  if (!res || !Array.isArray(res.data)) return res;
  return {
    ...res,
    data: res.data.map((row) => {
      const { store, ...rest } = row;
      const picked = store ? Object.fromEntries(STORE_FIELDS.map((f) => [f, store[f]])) : store;
      return { ...rest, store: picked };
    }),
  };
}

async function call(handle, fn, ...args) {
  handle.counter.reset();
  const value = await handle.actions[fn](...args);
  return { value, trips: handle.counter.total };
}

async function main() {
  quiet();
  const admin = makeServiceClient(ENV);
  if (ARGS.includes('--cleanup')) {
    const id = (await admin.from('stores').select('id').eq('store_code', FRANCHISE_STORE).single()).data.id;
    const log = await teardown(admin, { stores: { [FRANCHISE_STORE]: { id } }, franchisePrev: false });
    say('cleanup 完成', log.length ? log : '(無警告)');
    return;
  }
  const only = argVal('--only', null);
  const anon = () => createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const scenarios = only ? only.split(',') : undefined;
  say(`改前版本 = ${BASE}   改後版本 = 工作樹`);
  let fx;
  let fnCreated = false;
  try {
    prodFn.createProdFn();
    fnCreated = true;
    const probe = await admin.rpc(prodFn.FN, { p_user_id: '00000000-0000-0000-0000-000000000000', p_permission_code: 'x' });
    if (probe.error) throw new Error(`暫時函式 ${prodFn.FN} 不可用：${probe.error.message}`);
    fx = await setup(ENV, admin, anon, { scenarios });
    const keys = Object.keys(fx.users);
    say(`測試帳號 ${keys.length} 個，開始比對…\n`);

    const storeCodes = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04', FRANCHISE_STORE];
    const tripAgg = {};
    const addTrips = (fn, o, n) => {
      const t = (tripAgg[fn] ||= { old: [], new: [] });
      t.old.push(o);
      t.new.push(n);
    };
    const matrixRows = [];

    const runUser = async (key) => {
      const u = fx.users[key];
      const [oldH, newH] = await Promise.all([openActions(ENV, u.session, BASE, { rpcRename: { has_permission: prodFn.FN } }), openActions(ENV, u.session, NEW)]);

      // ---- A2：權限旗標
      const pO = await call(oldH, 'checkMonthlyStatusPermissions');
      const pN = await call(newH, 'checkMonthlyStatusPermissions');
      same(`[${key}] checkMonthlyStatusPermissions`, pO.value, pN.value);
      addTrips('checkMonthlyStatusPermissions', pO.trips, pN.trips);
      // roles.is_active=false 但 user_roles 有效 -> 正式區語意仍放行（改前改後都必須有旗標，證明參考值真的是正式區語意）
      if (key === 'role_inactive' || key === 'role_inactive_partial') {
        checks += 1;
        if (!FLAGS.some((f) => pO.value[f]) || !FLAGS.some((f) => pN.value[f])) {
          failures += 1;
          failLines.push(`不符正式區語意 [${key}] roles.is_active=false 但 user_roles 有效，應有旗標為 true`);
        }
      }
      if (key === 'role_inactive_ur_expired') {
        checks += 1;
        if (FLAGS.some((f) => pO.value[f]) || FLAGS.some((f) => pN.value[f])) {
          failures += 1;
          failLines.push(`不符正式區語意 [${key}] user_roles 過期應全部為 false`);
        }
      }
      matrixRows.push({ key, desc: u.desc, flags: FLAGS.filter((f) => pN.value[f]).map((f) => f.replace(/^can/, '')) });

      // ---- A2：可管門市
      const sO = await call(oldH, 'getUserManagedStores');
      const sN = await call(newH, 'getUserManagedStores');
      same(`[${key}] getUserManagedStores()`, pickStores(sO.value), pickStores(sN.value));
      addTrips('getUserManagedStores', sO.trips, sN.trips);
      const siO = await call(oldH, 'getUserManagedStores', { include_inactive: true });
      const siN = await call(newH, 'getUserManagedStores', { include_inactive: true });
      same(`[${key}] getUserManagedStores({include_inactive})`, siO.value, siN.value);

      // ---- A3：月度摘要
      const mO = await call(oldH, 'getMonthlyStoreSummaries', YM);
      const mN = await call(newH, 'getMonthlyStoreSummaries', YM);
      same(`[${key}] getMonthlyStoreSummaries`, normalizeSummaries(mO.value), normalizeSummaries(mN.value));
      addTrips('getMonthlyStoreSummaries', mO.trips, mN.trips);
      // 沒資料的月份
      const m0O = await call(oldH, 'getMonthlyStoreSummaries', '2099-12');
      const m0N = await call(newH, 'getMonthlyStoreSummaries', '2099-12');
      same(`[${key}] getMonthlyStoreSummaries(empty month)`, m0O.value, m0N.value);

      // ---- A1 / A4：每間測試門市
      for (const code of storeCodes) {
        const id = fx.stores[code].id;
        const aO = await call(oldH, 'getMonthlyStaffStatus', YM, id);
        const aN = await call(newH, 'getMonthlyStaffStatus', YM, id);
        same(`[${key}] getMonthlyStaffStatus(${code})`, aO.value, aN.value);
        if (code === 'VW001') addTrips('getMonthlyStaffStatus', aO.trips, aN.trips);
        const bO = await call(oldH, 'getStoreMonthlySummary', YM, id);
        const bN = await call(newH, 'getStoreMonthlySummary', YM, id);
        same(`[${key}] getStoreMonthlySummary(${code})`, bO.value, bN.value);
      }
      process.stdout.write('.');
    };
    const queue = [...keys];
    await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await runUser(queue.shift()); }));
    say('\n');

    // ---- 權限矩陣（改後；與改前逐項一致）
    say('角色 / 旗標矩陣（改前改後完全相同的結果，列出為 true 的旗標）');
    for (const r of matrixRows) say(`  ${r.key.padEnd(34)} ${r.flags.join(',') || '(無)'}`);
    say('\n往返次數（每個 action 單獨呼叫，中位數）');
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    for (const [fn, t] of Object.entries(tripAgg)) say(`  ${fn.padEnd(32)} 改前=${med(t.old)}  改後=${med(t.new)}`);
    say(`\n比對項目 ${checks} 項，不一致 ${failures} 項`);
    if (failures) {
      for (const l of failLines.slice(0, 30)) say(l);
    }
  } finally {
    const log = fx ? await teardown(admin, fx) : [];
    if (fnCreated) {
      try {
        prodFn.dropProdFn();
        say(`已 DROP 暫時函式 ${prodFn.FN}`);
      } catch (e) {
        say(`警告：DROP ${prodFn.FN} 失敗，請手動執行 node scripts/perf/prod-has-permission-fn.cjs drop：${e.message}`);
        failures += 1;
      }
    }
    say('清除測試資料：', log.length ? log.join('; ') : 'OK');
  }
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  loud();
  console.error(e);
  process.exitCode = 1;
});
