#!/usr/bin/env node
'use strict';
/**
 * 每月人員狀態頁：資料庫往返次數與伺服器端耗時量測（只連 DEV）。
 *
 * 照 app/monthly-status/page.tsx 的載入順序，直接呼叫「真正的」server action：
 *   階段 1（平行）：getUserManagedStores、checkMonthlyStatusPermissions
 *   階段 2（平行）：getMonthlyStoreSummaries、getMonthlyStaffStatus、getStoreMonthlySummary × N
 *                  N = 統計表單 + 支援時數表單各讀一次（改前 = 2；A4 之後父層只讀 1 次）
 * 並計算每個階段的 HTTP 往返（auth / rest / rpc）與牆鐘時間。
 *
 * 用法：
 *   node scripts/perf/measure-monthly-status.cjs [--ref worktree|<git ref>] [--stats-reads 2|1|auto]
 *                                                [--runs 5] [--json out.json] [--cleanup]
 *   --stats-reads auto：依 --ref 判斷（git ref = 改前 = 兩表單各讀一次；worktree = 以目前程式為準，看 page.tsx 實作）
 *
 * 帳號與 2099-01 資料由 ms-fixture 建立，結束（含失敗）一律清除。
 */
const fs = require('node:fs');
const { loadDevEnv, ROOT } = require('./dev-env.cjs');
const { setup, teardown, cleanupAll, YM, FRANCHISE_STORE } = require('./ms-fixture.cjs');
const { openActions, makeServiceClient } = require('./ms-harness.cjs');

const ARGS = process.argv.slice(2);
const argVal = (n, d) => {
  const i = ARGS.indexOf(n);
  return i >= 0 ? ARGS[i + 1] : d;
};
process.chdir(ROOT);
const ENV = loadDevEnv();
const { createClient } = require(require('node:path').join(ROOT, 'node_modules', '@supabase', 'supabase-js'));

const REF = argVal('--ref', 'worktree');
const RUNS = Number(argVal('--runs', '5'));
const STATS_READS = argVal('--stats-reads', 'auto');
const JSON_OUT = argVal('--json', null);

const MEASURE_USERS = ['admin_role_real', 'store_manager_full', 'supervisor_multi', 'view_all_user'];

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

async function runOnce(user, fx) {
  const { actions, counter } = await openActions(ENV, user.session, REF);
  const t0 = Date.now();
  const p1 = await Promise.all([actions.getUserManagedStores(), actions.checkMonthlyStatusPermissions()]);
  const t1 = Date.now();
  const trips1 = counter.total;
  const [storesRes, perms] = p1;
  if (!storesRes.success) throw new Error(`getUserManagedStores 失敗：${storesRes.error}`);
  const stores = storesRes.data;
  const target = stores.find((s) => s.store_code === 'VW001') || stores.find((s) => s.store_code === 'VW002') || stores[0];

  // 頁面以 title / role 判斷是否可編輯支援時數（對應 page.tsx 的 hasEditSupportPermission）
  const isStoreManagerTitle = ['店長', '代理店長', '督導', '督導(代理店長)'].includes(storesRes.job_title);
  const hasEdit = perms.canEditSupportHours || ['admin', 'supervisor', 'area_manager'].includes(storesRes.role) || isStoreManagerTitle;
  const viewStats = perms.canViewStats;
  let statsReads = 0;
  if (STATS_READS === 'auto') {
    statsReads = viewStats && hasEdit ? 2 : viewStats || hasEdit ? 1 : 0;
  } else {
    statsReads = Math.min(Number(STATS_READS), viewStats && hasEdit ? 2 : viewStats || hasEdit ? 1 : 0);
  }

  const calls = [actions.getMonthlyStoreSummaries(YM), target ? actions.getMonthlyStaffStatus(YM, target.id) : Promise.resolve({ success: true, data: [] })];
  for (let i = 0; i < statsReads; i++) calls.push(target ? actions.getStoreMonthlySummary(YM, target.id) : Promise.resolve(null));
  const p2 = await Promise.all(calls);
  const t2 = Date.now();
  return {
    phase1Ms: t1 - t0,
    phase2Ms: t2 - t1,
    totalMs: t2 - t0,
    trips1,
    trips2: counter.total - trips1,
    tripsTotal: counter.total,
    byKind: { ...counter.byKind },
    stores: stores.length,
    summaries: (p2[0].data || []).length,
    staff: ((p2[1] && p2[1].data) || []).length,
    statsReads,
  };
}

(async () => {
  const admin = makeServiceClient(ENV);
  if (ARGS.includes('--cleanup')) {
    const log = await teardown(admin, { stores: { [FRANCHISE_STORE]: { id: (await admin.from('stores').select('id').eq('store_code', FRANCHISE_STORE).single()).data.id } }, franchisePrev: false });
    console.log('cleanup 完成', log.length ? log : '(無警告)');
    return;
  }
  const anon = () => createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let fx;
  const results = {};
  try {
    fx = await setup(ENV, admin, anon, { scenarios: MEASURE_USERS });
    console.log(`ref=${REF}  runs=${RUNS}  stats-reads=${STATS_READS}`);
    for (const key of MEASURE_USERS) {
      await runOnce(fx.users[key], fx); // 暖機（JIT / TLS / 連線）
      const rs = [];
      for (let i = 0; i < RUNS; i++) rs.push(await runOnce(fx.users[key], fx));
      results[key] = {
        stores: rs[0].stores,
        statsReads: rs[0].statsReads,
        trips1: rs[0].trips1,
        trips2: rs[0].trips2,
        tripsTotal: rs[0].tripsTotal,
        byKind: rs[0].byKind,
        phase1MsMedian: median(rs.map((r) => r.phase1Ms)),
        phase2MsMedian: median(rs.map((r) => r.phase2Ms)),
        totalMsMedian: median(rs.map((r) => r.totalMs)),
        allTotalMs: rs.map((r) => r.totalMs),
      };
      const r = results[key];
      console.log(
        `${key.padEnd(22)} stores=${r.stores} statsReads=${r.statsReads}  往返: 階段1=${r.trips1} 階段2=${r.trips2} 合計=${r.tripsTotal} ${JSON.stringify(r.byKind)}  耗時(中位數ms): 階段1=${r.phase1MsMedian} 階段2=${r.phase2MsMedian} 合計=${r.totalMsMedian}`
      );
    }
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ ref: REF, runs: RUNS, results }, null, 2));
  } finally {
    const log = await teardown(admin, fx);
    console.log('清除測試資料：', log.length ? log.join('; ') : 'OK');
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
