#!/usr/bin/env node
'use strict';
/**
 * 藥師「入職未同步」修正測試。
 *
 *  1. 純函式單元測試：補列條件（在職、當時是藥師、該月已入職、從未出現在該月以前名單）、
 *     該月門市依「最近入職或調店」推算（調店當月維持原店）、主檔同步挑選
 *  2. 靜態檢查：兩條寫入路徑（批次新增、單筆修改）都呼叫主檔同步；每月快照使用補列且不受 sync_log 跳過影響
 *  3. DEV 整合測試（只連 DEV；只用 ZT 測試門市、2098 保留月份；用 id/員編精準刪除，結束檢查 0 殘留）：
 *       新門市、入職勾是藥師、主檔 false、無快照 -> 修正後該月與之後月份出現；
 *       sync_log 判定「無變動」時仍會補上；已關帳月份不變；不是藥師的人不會被補；
 *       入職日在該月之後的人不會提前被補。
 *
 * 用法：node scripts/test-pharmacist-onboarding-backfill.cjs [--no-db]
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadDevEnv, ROOT } = require('./perf/dev-env.cjs');

process.chdir(ROOT);
const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
function loadTs(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports;
}
const B = loadTs('lib/pharmacist/onboarding-backfill.ts');
const M = loadTs('lib/pharmacist/onboarding-master-sync.ts');
const T = loadTs('lib/pharmacist/sync-trigger.ts');
const C = loadTs('lib/pharmacist-snapshot-carry.ts');

function ok(name, fn) {
  try { fn(); console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.message)); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.message)); process.exitCode = 1; }
}

// ---------- 1. 純函式 ----------
console.log('[1] pure functions');
const emp = (o) => ({ employee_code: 'FK1', employee_name: 'x', store_id: 's1', is_active: true, is_pharmacist: false, start_date: null, position: '專員', current_position: '新人', ...o });
const onb = (o) => ({ employee_code: 'FK1', movement_date: '2026-05-01', created_at: '2026-05-01T01:00:00Z', onboarding_is_pharmacist: true, ...o });
const run = (employees, onboardings, existing = [], ym = '2026-05') =>
  B.computeMissingOnboardingPharmacists({ targetYearMonth: ym, employees, onboardings, existingCodes: new Set(existing) });

ok('monthEndOf handles month lengths and leap year', () => {
  assert.equal(B.monthEndOf('2026-02'), '2026-02-28');
  assert.equal(B.monthEndOf('2028-02'), '2028-02-29');
  assert.equal(B.monthEndOf('2026-11'), '2026-11-30');
});
ok('master false + onboarding flag true + no snapshot -> backfilled in own store with note', () => {
  const r = run([emp({})], [onb({})]);
  assert.equal(r.length, 1);
  assert.equal(r[0].store_id, 's1');
  assert.equal(r[0].is_active, true);
  assert.equal(r[0].notes, 'backfilled: onboarding not synced');
  assert.equal(r[0].position, '新人');
});
ok('also appears in later months', () => {
  assert.equal(run([emp({})], [onb({})], [], '2026-11').length, 1);
});
ok('not yet onboarded in that month -> not backfilled', () => {
  assert.equal(run([emp({})], [onb({ movement_date: '2026-06-01' })], [], '2026-05').length, 0);
  assert.equal(run([emp({})], [onb({ movement_date: '2026-05-31' })], [], '2026-05').length, 1);
});
ok('non-pharmacist (flag false, master false) is not backfilled', () => {
  assert.equal(run([emp({})], [onb({ onboarding_is_pharmacist: false })]).length, 0);
});
ok('master is pharmacist NOW but was onboarded as non-pharmacist -> not backfilled into past months', () => {
  assert.equal(run([emp({ is_pharmacist: true })], [onb({ movement_date: '2024-03-01', onboarding_is_pharmacist: false })], [], '2025-01').length, 0);
});
ok('master flag deliberately false but onboarding flag true: backfilled only while never seen; once in a roster it is not re-added', () => {
  assert.equal(run([emp({ is_pharmacist: false })], [onb({})]).length, 1);
  assert.equal(run([emp({ is_pharmacist: false })], [onb({})], ['FK1']).length, 0);
});
ok('latest onboarding up to month end decides the flag', () => {
  const list = [onb({ movement_date: '2026-01-01', onboarding_is_pharmacist: true }), onb({ movement_date: '2026-03-01', onboarding_is_pharmacist: false })];
  assert.equal(run([emp({})], list).length, 0);
  assert.equal(run([emp({})], list, [], '2026-02').length, 1);
});
ok('already in the month roster (any store) -> not duplicated', () => {
  assert.equal(run([emp({})], [onb({})], ['FK1']).length, 0);
});
ok('inactive employee is not backfilled', () => {
  assert.equal(run([emp({ is_active: false })], [onb({})]).length, 0);
});
ok('no onboarding movement at all (even master pharmacist with start_date) -> no evidence, skipped', () => {
  assert.equal(run([emp({ is_pharmacist: true, start_date: '2025-01-01' })], []).length, 0);
});
const tr = (o) => ({ employee_code: 'FK1', movement_type: 'store_transfer', store_id: 's2', movement_date: '2026-08-15', created_at: '2026-08-15T01:00:00Z', onboarding_is_pharmacist: null, ...o });
const storeOf = (list, ym) => { const r = run([emp({ store_id: 's2' })], list, [], ym); return r.length ? r[0].store_id : null; };
ok('month store: before the transfer month uses the onboarding store, not the current master store', () => {
  const list = [onb({ store_id: 's1' }), tr({})];
  assert.equal(storeOf(list, '2026-05'), 's1');
  assert.equal(storeOf(list, '2026-07'), 's1');
});
ok('month store: transfer month stays at the old store, next month moves (same rule as reconcile)', () => {
  const list = [onb({ store_id: 's1' }), tr({})];
  assert.equal(storeOf(list, '2026-08'), 's1');
  assert.equal(storeOf(list, '2026-09'), 's2');
  assert.equal(storeOf([onb({ store_id: 's1' }), tr({ movement_date: '2026-08-01' })], '2026-08'), 's2');
});
ok('month store: out-of-scope current store but in-scope store back then is still backfilled there', () => {
  const mk = (ym) => B.computeMissingOnboardingPharmacists({ targetYearMonth: ym, employees: [emp({ store_id: 's2' })], onboardings: [onb({ store_id: 's1' }), tr({})], existingCodes: new Set(), scopeStoreIds: ['s1'] });
  assert.deepEqual(mk('2026-06').map(x => x.store_id), ['s1']);
  assert.equal(mk('2026-09').length, 0);
});
ok('transfer rows never count as onboarding evidence', () => {
  assert.equal(run([emp({})], [tr({ store_id: 's1', movement_date: '2026-04-01', onboarding_is_pharmacist: true })]).length, 0);
});
ok('store out of scope / missing store is skipped; duplicates collapse', () => {
  const r = B.computeMissingOnboardingPharmacists({ targetYearMonth: '2026-05', employees: [emp({ store_id: 'other' }), emp({ employee_code: 'FK2' }), emp({ employee_code: 'FK2' })], onboardings: [onb({ employee_code: 'FK2' })], existingCodes: new Set(), scopeStoreIds: ['s1'] });
  assert.deepEqual(r.map(x => x.employee_code), ['FK2']);
  assert.equal(run([emp({ store_id: null })], [onb({})]).length, 0);
});
ok('master sync picks only pharmacists, uppercased, deduped', () => {
  assert.deepEqual(M.pickOnboardingPharmacistCodes([
    { employee_code: 'fk1', is_pharmacist: true }, { employee_code: 'FK1', is_pharmacist: true },
    { employee_code: 'FK2', is_pharmacist: false }, { employee_code: '', is_pharmacist: true }, { employee_code: 'FK3' },
  ]), ['FK1']);
});

// ---------- 2. 靜態檢查 ----------
console.log('[2] wiring');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const batch = read('app/api/employee-movements/batch/route.ts');
const single = read('app/api/employee-movements/[id]/route.ts');
const page = read('app/admin/pharmacist-management/page.tsx');
ok('batch create syncs master for every onboarding movement (not only with birthday)', () => {
  assert.match(batch, /syncOnboardingPharmacistToEmployeeMaster\(/);
  assert.match(batch, /\.filter\(\(m\) => m\.movement_type === 'onboarding'\)\s*\.map\(\(m\) => \(\{ employee_code: m\.employee_code, is_pharmacist: Boolean\(m\.onboarding_is_pharmacist\)/);
});
ok('single edit syncs master when onboarding is_pharmacist is true, never writes false', () => {
  assert.match(single, /updated\.onboarding_is_pharmacist === true/);
  assert.match(single, /syncOnboardingPharmacistToEmployeeMaster\(/);
});
ok('monthly overview: backfill is part of the skip decision and runs before applying movements', () => {
  assert.match(page, /findMissingOnboardingPharmacists\(adminSupabase, targetYearMonth, storeIds\)/);
  assert.match(page, /!hasTriggeringMovement && missingOnboardingRows\.length === 0/);
  assert.ok(page.indexOf('missingOnboardingRows) {') < page.indexOf('階段 2：應用當月異動'));
  assert.ok(page.indexOf("if (lockedMonthSet.has(targetYearMonth)) return;") < page.indexOf('findMissingOnboardingPharmacists(adminSupabase'));
});

// ---------- 3. DEV 整合 ----------
async function dbTests() {
  console.log('[3] DEV integration');
  const ENV = loadDevEnv();
  const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
  const db = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: stores, error: se } = await db.from('stores').select('id, store_code').in('store_code', ['ZT01', 'ZT02']);
  if (se) throw se;
  const sid = Object.fromEntries(stores.map((s) => [s.store_code, s.id]));
  assert.ok(sid.ZT01 && sid.ZT02, 'DEV 缺 ZT01/ZT02 測試門市');
  const storeIds = [sid.ZT01, sid.ZT02];
  const MONTHS = ['2098-01', '2098-02', '2098-03', '2098-04', '2098-05'];

  // 保留月份必須是空的
  for (const t of ['pharmacist_monthly_snapshot', 'pharmacist_monthly_snapshot_sync_log', 'pharmacist_snapshot_locks']) {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true }).in('year_month', MONTHS);
    if (error) throw error;
    assert.equal(count, 0, `${t} 的 2098 保留月份不是空的，拒絕執行`);
  }

  // 找一段沒用過的 FKF9xxxx 員編
  let tag;
  for (let i = 0; i < 30; i++) {
    const n = Math.floor(Math.random() * 990);
    const codes = Array.from({ length: 8 }, (_, k) => 'FKF' + String(90000 + n * 10 + k));
    const a = await db.from('employee_movement_history').select('id', { count: 'exact', head: true }).in('employee_code', codes);
    const b = await db.from('store_employees').select('id', { count: 'exact', head: true }).in('employee_code', codes);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    if (a.count === 0 && b.count === 0) { tag = 90000 + n * 10; break; }
  }
  assert.ok(tag, 'no free test employee code block');
  const code = (k) => 'FKF' + String(tag + k);
  const codes = Array.from({ length: 8 }, (_, k) => code(k));
  const movementIds = [];
  const employeeIds = [];

  async function addEmp(k, row) {
    const { data, error } = await db.from('store_employees').insert({ employee_code: code(k), employee_name: '入職補列測試' + k, store_id: sid.ZT01, is_active: true, is_pharmacist: false, position: '專員', current_position: '新人', employment_type: 'full_time', ...row }).select('id').single();
    if (error) throw error;
    employeeIds.push(data.id);
  }
  async function addOnb(k, date, flag) {
    const { data, error } = await db.from('employee_movement_history').insert({ employee_code: code(k), employee_name: '入職補列測試' + k, store_id: sid.ZT01, movement_type: 'onboarding', movement_date: date, onboarding_is_pharmacist: flag }).select('id').single();
    if (error) throw error;
    movementIds.push(data.id);
  }

  async function addTransfer(k, date, toStore) {
    const { data, error } = await db.from('employee_movement_history').insert({ employee_code: code(k), employee_name: '入職補列測試' + k, store_id: toStore, movement_type: 'store_transfer', movement_date: date }).select('id').single();
    if (error) throw error;
    movementIds.push(data.id);
  }

  // 用真正的 ensureSnapshotForMonth 原始碼，接真實 DEV client
  const pageSrc = page.replace(/\r\n/g, '\n');
  const noteStart = pageSrc.indexOf('function appendNote(');
  const appendNoteSource = ts.transpileModule(pageSrc.slice(noteStart).match(/^[\s\S]*?\n\}/)[0], { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const start = pageSrc.indexOf('  async function ensureSnapshotForMonth(');
  const end = pageSrc.indexOf('\n  let currentRowsRaw:', start);
  const fnSource = ts.transpileModule(pageSrc.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  function makeEnsure({ locked = [], noBackfill = false } = {}) {
    const ctx = {
      adminSupabase: db, canUseSnapshot: true, lockedMonthSet: new Set(locked), storeIds,
      getPreviousYearMonth: (ym) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); },
      hasMissingPharmacistCarry: C.hasMissingPharmacistCarry,
      hasSyncTriggeringMovement: T.hasSyncTriggeringMovement,
      taiwanDateOf: T.taiwanDateOf,
      findMissingOnboardingPharmacists: noBackfill ? async () => [] : B.findMissingOnboardingPharmacists,
      console,
    };
    vm.createContext(ctx);
    vm.runInContext(appendNoteSource, ctx);
    vm.runInContext(fnSource, ctx);
    return (ym) => ctx.ensureSnapshotForMonth(ym);
  }
  async function rows(ym, k) {
    const { data, error } = await db.from('pharmacist_monthly_snapshot').select('employee_code, store_id, is_active, notes').eq('year_month', ym).eq('employee_code', code(k));
    if (error) throw error;
    return data;
  }

  try {
    // A：新門市、入職(2098-01-10)勾是藥師、主檔 false、無快照
    await addEmp(0, {}); await addOnb(0, '2098-01-10', true);
    // B：入職勾「否」、主檔 false -> 不是藥師
    await addEmp(1, {}); await addOnb(1, '2098-01-12', false);
    // C：是藥師，但 2098-03-10 才入職
    await addEmp(2, {}); await addOnb(2, '2098-03-10', true);
    // D：離職（主檔不在職）的藥師 -> 不補
    await addEmp(3, { is_active: false, is_pharmacist: true, start_date: '2098-01-01' });
    // E：主檔就是藥師、有入職異動（舊資料已正確）-> 也會補（不在名單）
    await addEmp(4, { is_pharmacist: true }); await addOnb(4, '2098-01-05', true);

    // F：入職在 ZT01、2098-01-20 調到 ZT02（2098-02 起在 ZT02）；主檔現在在 ZT02
    await addEmp(5, { store_id: sid.ZT02 }); await addOnb(5, '2098-01-10', true); await addTransfer(5, '2098-01-20', sid.ZT02);
    // G：入職在 ZT01、2098-03-15 才調到 ZT02（2098-02 仍在 ZT01，2098-03 當月仍維持 ZT01）；主檔現在在 ZT02
    await addEmp(6, { store_id: sid.ZT02 }); await addOnb(6, '2098-01-10', true); await addTransfer(6, '2098-03-15', sid.ZT02);

    // 先重現舊行為：sync_log 判定「無變動」時，舊程式（沒有補列）完全不會補 A
    const future = new Date(Date.now() + 86400000).toISOString();
    {
      const { error } = await db.from('pharmacist_monthly_snapshot').insert({ year_month: '2098-02', store_id: sid.ZT02, employee_code: code(7), employee_name: '既有快照', is_active: true, source: 'manual', notes: 'test seed' });
      if (error) throw error;
      const { error: e2 } = await db.from('pharmacist_monthly_snapshot_sync_log').upsert({ year_month: '2098-02', last_synced_at: future }, { onConflict: 'year_month' });
      if (e2) throw e2;
    }
    await okAsync('BEFORE fix (no backfill): sync_log says unchanged -> A stays missing in 2098-02', async () => {
      await makeEnsure({ noBackfill: true })('2098-02');
      assert.equal((await rows('2098-02', 0)).length, 0);
    });
    await okAsync('AFTER fix: same month, sync_log still says unchanged -> A is backfilled into own store with note', async () => {
      await makeEnsure()('2098-02');
      const r = await rows('2098-02', 0);
      assert.equal(r.length, 1);
      assert.equal(r[0].store_id, sid.ZT01);
      assert.equal(r[0].is_active, true);
      assert.match(r[0].notes, /backfilled: onboarding not synced/);
    });
    await okAsync('non-pharmacist B, resigned D, not-yet-onboarded C are not backfilled in 2098-02', async () => {
      assert.equal((await rows('2098-02', 1)).length, 0);
      assert.equal((await rows('2098-02', 3)).length, 0);
      assert.equal((await rows('2098-02', 2)).length, 0);
    });
    await okAsync('master-true E with onboarding movement and no row is also filled', async () => {
      assert.equal((await rows('2098-02', 4)).length, 1);
    });
    await okAsync('transferred pharmacists are backfilled into the store they belonged to that month (not the current master store)', async () => {
      const f = await rows('2098-02', 5), g = await rows('2098-02', 6);
      assert.equal(f.length, 1); assert.equal(f[0].store_id, sid.ZT02); // 01-20 調店，02 月已生效
      assert.equal(g.length, 1); assert.equal(g[0].store_id, sid.ZT01); // 03-15 才調店，02 月仍在原店
    });
    await okAsync('later month 2098-03 contains A (carried), C appears once onboarded, B never', async () => {
      await makeEnsure()('2098-03');
      assert.equal((await rows('2098-03', 0)).length, 1);
      assert.equal((await rows('2098-03', 2)).length, 1);
      assert.equal((await rows('2098-03', 1)).length, 0);
      assert.equal((await rows('2098-03', 3)).length, 0);
      const g = await rows('2098-03', 6);
      assert.equal(g.length, 1); assert.equal(g[0].store_id, sid.ZT01); // 調店當月維持原店
    });
    await okAsync('first generation month 2098-01: backfilled row survives the old "non-pharmacist movement" cleanup', async () => {
      await makeEnsure()('2098-01');
      const r = await rows('2098-01', 0);
      assert.equal(r.length, 1);
      assert.match(r[0].notes, /backfilled: onboarding not synced/);
      assert.equal((await rows('2098-01', 1)).length, 0);
      const f = await rows('2098-01', 5);
      assert.equal(f.length, 1); assert.equal(f[0].store_id, sid.ZT01); // 調店前的月份放入職門市（即使後面月份已有 F 的列）
    });
    await okAsync('re-running with nothing missing rewrites nothing and creates nothing (updated_at and row set unchanged)', async () => {
      const snap = async () => {
        const { data, error } = await db.from('pharmacist_monthly_snapshot').select('id, updated_at, notes, store_id').in('year_month', MONTHS).in('employee_code', codes).order('id');
        if (error) throw error;
        return data;
      };
      // 對照組：確認 updated_at 真的偵測得到改寫（否則這個測試沒有意義）
      const control = (await snap())[0];
      await new Promise(r => setTimeout(r, 30));
      const { error: ce } = await db.from('pharmacist_monthly_snapshot').update({ notes: control.notes }).eq('id', control.id);
      if (ce) throw ce;
      const afterControl = (await snap()).find(r => r.id === control.id);
      assert.notEqual(afterControl.updated_at, control.updated_at, 'updated_at 不會隨改寫變動，無法偵測重複寫入');

      const before = await snap();
      await new Promise(r => setTimeout(r, 50));
      await makeEnsure()('2098-02');
      await makeEnsure()('2098-03');
      const after = await snap();
      assert.deepEqual(after, before);
    });
    await okAsync('locked month 2098-04 is never touched (no rows created)', async () => {
      const { error } = await db.from('pharmacist_snapshot_locks').insert({ year_month: '2098-04', locked_by: 'test' });
      if (error) throw error;
      await makeEnsure({ locked: ['2098-04'] })('2098-04');
      const { count } = await db.from('pharmacist_monthly_snapshot').select('id', { count: 'exact', head: true }).eq('year_month', '2098-04').in('store_id', storeIds);
      assert.equal(count, 0);
      const log = await db.from('pharmacist_monthly_snapshot_sync_log').select('year_month').eq('year_month', '2098-04');
      assert.equal(log.data.length, 0);
    });
    await okAsync('master sync: sets false->true only, never true->false, leaves position text alone', async () => {
      await M.syncOnboardingPharmacistToEmployeeMaster(db, [{ employee_code: code(0), is_pharmacist: true }, { employee_code: code(1), is_pharmacist: false }, { employee_code: code(4), is_pharmacist: false }]);
      const { data } = await db.from('store_employees').select('employee_code, is_pharmacist, position, current_position').in('employee_code', [code(0), code(1), code(4)]);
      const by = Object.fromEntries(data.map(r => [r.employee_code, r]));
      assert.equal(by[code(0)].is_pharmacist, true);
      assert.equal(by[code(0)].position, '專員');
      assert.equal(by[code(0)].current_position, '新人');
      assert.equal(by[code(1)].is_pharmacist, false);
      assert.equal(by[code(4)].is_pharmacist, true);
    });
  } finally {
    // 只刪自己建立的資料
    const errs = [];
    const del = async (p) => { const { error } = await p; if (error) errs.push(error.message); };
    await del(db.from('pharmacist_monthly_snapshot').delete().in('year_month', MONTHS).in('store_id', storeIds));
    await del(db.from('pharmacist_monthly_snapshot_sync_log').delete().in('year_month', MONTHS));
    await del(db.from('pharmacist_snapshot_locks').delete().in('year_month', MONTHS));
    if (movementIds.length) await del(db.from('employee_movement_history').delete().in('id', movementIds));
    if (employeeIds.length) await del(db.from('store_employees').delete().in('id', employeeIds));
    const left = [];
    for (const [t, col, vals] of [
      ['pharmacist_monthly_snapshot', 'year_month', MONTHS], ['pharmacist_monthly_snapshot_sync_log', 'year_month', MONTHS],
      ['pharmacist_snapshot_locks', 'year_month', MONTHS], ['employee_movement_history', 'employee_code', codes], ['store_employees', 'employee_code', codes],
    ]) {
      const { count } = await db.from(t).select('*', { count: 'exact', head: true }).in(col, vals);
      left.push(`${t}=${count}`);
      if (count) process.exitCode = 1;
    }
    console.log('  orphan check: ' + left.join(', ') + (errs.length ? ' | cleanup errors: ' + errs.join('; ') : ''));
  }
}

(async () => {
  if (!process.argv.includes('--no-db')) await dbTests();
  console.log(process.exitCode ? 'FAILED' : 'ALL PASSED');
})().catch((e) => { console.error(e); process.exitCode = 1; });
