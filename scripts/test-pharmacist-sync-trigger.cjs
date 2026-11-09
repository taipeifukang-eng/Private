#!/usr/bin/env node
'use strict';
/**
 * 藥師主檔 / 每月藥師快照「漏同步」觸發判斷測試。
 *
 *  1. 純函式單元測試（台灣日期、三條件）
 *  2. 靜態檢查：sync route / 督導區總覽頁都改用 hasSyncTriggeringMovement，畫面顯示真正的 last_synced_at
 *  3. DEV 整合測試（只連 DEV，只用 ZT 測試門市、2099 年度的測試資料，「今天」用注入方式）：
 *       三種漏同步情況，「改前」的判斷（只看 created_at）會漏，「改後」會補上；
 *       沒有變動時仍跳過；邊界日期、類型與範圍外不觸發。
 *     測試資料用 id 精準刪除，結束檢查 0 殘留。
 *
 * 用法：node scripts/test-pharmacist-sync-trigger.cjs [--no-db]
 */
const fs = require('node:fs');
const path = require('node:path');
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
const T = loadTs('lib/pharmacist/sync-trigger.ts');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + (e && e.message));
    process.exitCode = 1;
  }
}
async function okAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + (e && (e.message || JSON.stringify(e))));
    process.exitCode = 1;
  }
}

// ---------- 1. 純函式 ----------
console.log('[1] pure functions');
ok('taiwanDateOf crosses UTC midnight', () => {
  assert.equal(T.taiwanDateOf('2026-10-30T11:44:00Z'), '2026-10-30');
  assert.equal(T.taiwanDateOf('2026-10-30T16:00:00Z'), '2026-10-31');
  assert.equal(T.taiwanDateOf('2026-10-30T15:59:59Z'), '2026-10-30');
});
ok('formatTaiwanDateTime', () => {
  assert.equal(T.formatTaiwanDateTime('2026-10-30T11:44:00Z'), '2026-10-30 19:44');
  assert.equal(T.formatTaiwanDateTime('2026-10-30T20:05:00+00:00'), '2026-10-31 04:05');
  assert.equal(T.formatTaiwanDateTime('garbage'), '');
});
const LAST = '2026-10-30T11:44:00Z'; // 台灣 10/30 19:44
const base = { created_at: '2026-10-30T02:11:00Z', updated_at: '2026-10-30T02:11:00Z', movement_date: '2026-11-02' };
ok('FK1299 case: registered before sync, effective 11/02 -> triggers on 11/02, not before', () => {
  assert.equal(T.movementTriggersSync(base, LAST, '2026-11-01'), false);
  assert.equal(T.movementTriggersSync(base, LAST, '2026-11-02'), true);
});
ok('(a) created_at after last sync', () => {
  assert.equal(T.movementTriggersSync({ ...base, created_at: '2026-10-30T12:00:00Z', movement_date: '2026-10-01' }, LAST, '2026-11-06'), true);
});
ok('(b) updated_at after last sync', () => {
  assert.equal(T.movementTriggersSync({ ...base, updated_at: '2026-10-31T00:00:00Z', movement_date: '2026-10-01' }, LAST, '2026-11-06'), true);
});
ok('(c) boundaries: last sync date excluded, today included', () => {
  const old = { created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
  assert.equal(T.movementTriggersSync({ ...old, movement_date: '2026-10-30' }, LAST, '2026-11-06'), false);
  assert.equal(T.movementTriggersSync({ ...old, movement_date: '2026-10-31' }, LAST, '2026-11-06'), true);
  assert.equal(T.movementTriggersSync({ ...old, movement_date: '2026-11-06' }, LAST, '2026-11-06'), true);
  assert.equal(T.movementTriggersSync({ ...old, movement_date: '2026-11-07' }, LAST, '2026-11-06'), false);
});
ok('no change -> skip', () => {
  assert.equal(T.movementTriggersSync({ ...base, movement_date: '2026-10-20' }, LAST, '2026-11-06'), false);
});
ok('or filter string is timezone-safe and matches the three conditions', () => {
  const f = T.buildSyncTriggerOrFilter('2026-10-30T11:44:00+00:00', '2026-11-06');
  assert.equal(
    f,
    'created_at.gt.2026-10-30T11:44:00.000Z,updated_at.gt.2026-10-30T11:44:00.000Z,and(movement_date.gt.2026-10-30,movement_date.lte.2026-11-06)',
  );
});

// ---------- 2. 靜態檢查 ----------
console.log('[2] wiring');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const route = read('app/api/pharmacist-annual-master/sync/route.ts');
const page = read('app/admin/pharmacist-management/page.tsx');
const list = read('app/admin/pharmacist-management/PharmacistMasterList.tsx');
ok('annual master route uses shared trigger, Taiwan today, returns real last_synced_at', () => {
  assert.match(route, /hasSyncTriggeringMovement\(/);
  assert.doesNotMatch(route, /\.gt\('created_at', lastSyncedAt\)/);
  assert.match(route, /taiwanDateOf\(new Date\(\)\)/);
  assert.doesNotMatch(route, /syncedAt: isLocked \? null : new Date\(\)/);
  assert.match(route, /syncedAt: isLocked \? null : lastSyncedAt/);
  assert.match(route, /if \(!isLocked( && !readOnly)?\) \{/); // locked years still skip sync (readonly=1 also skips writes)
});
ok('monthly overview uses shared trigger with month scope + store scope', () => {
  assert.match(page, /hasSyncTriggeringMovement\(/);
  assert.doesNotMatch(page, /\.gt\('created_at', lastSyncedAt\)/);
  assert.match(page, /rangeStart: monthStart/);
  assert.match(page, /storeIds,/);
});
ok('screen shows last sync time in Taiwan time', () => {
  assert.match(list, /最後同步：\{formatTaiwanDateTime\(syncedAt\)\}/);
  assert.doesNotMatch(list, /已自動同步人事異動/);
});

// ---------- 3. DEV 整合 ----------
async function dbTests() {
  console.log('[3] DEV integration');
  const ENV = loadDevEnv();
  const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
  const db = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: stores, error: se } = await db.from('stores').select('id, store_code').in('store_code', ['ZT01', 'ZT02']);
  if (se) throw se;
  const byCode = Object.fromEntries(stores.map((s) => [s.store_code, s.id]));
  assert.ok(byCode.ZT01 && byCode.ZT02, 'DEV 缺 ZT01/ZT02 測試門市');

  // DEV 有員編規則 trigger（入職異動需 FK####/FKF#####/FKPT###）：用 FKF9xxxx 測試員編，並確認該區段沒有既有資料
  let tag;
  for (let i = 0; i < 20; i++) {
    const n = Math.floor(Math.random() * 990);
    const codes = Array.from({ length: 7 }, (_, k) => 'FKF' + String(90000 + n * 10 + k));
    const { count, error } = await db.from('employee_movement_history').select('id', { count: 'exact', head: true }).in('employee_code', codes);
    if (error) throw error;
    if (count === 0) { tag = 90000 + n * 10; break; }
  }
  assert.ok(tag, 'no free test employee code block');
  const code = (k) => 'FKF' + String(tag + k);
  const created = [];
  async function insert(row) {
    const { data, error } = await db
      .from('employee_movement_history')
      .insert({ employee_name: '同步測試', store_id: byCode.ZT01, ...row })
      .select('id, created_at, updated_at')
      .single();
    if (error) throw error;
    created.push(data.id);
    return data;
  }
  // 舊版判斷（修正前 route / page 的寫法）：只看 created_at
  async function oldNeedsSync({ lastSyncedAt, types, start, end, codes, storeIds }) {
    let q = db
      .from('employee_movement_history')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', lastSyncedAt)
      .in('movement_type', types)
      .gte('movement_date', start)
      .lte('movement_date', end)
      .in('employee_code', codes);
    if (storeIds) q = q.in('store_id', storeIds);
    const { count, error } = await q;
    if (error) throw error;
    return (count ?? 0) > 0;
  }
  const TYPES = ['resignation', 'leave_without_pay', 'leave_of_absence', 'return_to_work', 'onboarding'];
  const newNeedsSync = (o) =>
    T.hasSyncTriggeringMovement(db, {
      lastSyncedAt: o.lastSyncedAt,
      today: o.today,
      movementTypes: o.types || TYPES,
      rangeStart: o.start,
      rangeEnd: o.end,
      employeeCodes: o.codes,
      storeIds: o.storeIds,
    });

  // 時間軸（全部在 2099 測試期間）：登錄 03-01 02:00Z，同步 03-01 10:00Z（台灣 03-01 18:00）
  const REG = '2099-03-01T02:00:00Z';
  const LASTSYNC = '2099-03-01T10:00:00Z';
  const Y0 = '2099-01-01';
  const Y1 = '2099-12-31';

  try {
    await okAsync('DB trigger bumps updated_at on UPDATE (relied on by condition b)', async () => {
      const r = await insert({ employee_code: code(6), movement_type: 'onboarding', movement_date: '2099-03-05', onboarding_is_pharmacist: false, created_at: '2000-01-01T00:00:00Z', updated_at: '2000-01-01T00:00:00Z' });
      const { data, error } = await db.from('employee_movement_history').update({ onboarding_is_pharmacist: true }).eq('id', r.id).select('updated_at').single();
      if (error) throw error;
      assert.ok(new Date(data.updated_at) > new Date('2000-01-01T00:00:00Z'), 'updated_at was not bumped');
    });

    // 情況 1：提前登錄的入職，生效日之後才開頁
    const c1 = code(0);
    await insert({ employee_code: c1, movement_type: 'onboarding', movement_date: '2099-03-10', onboarding_is_pharmacist: true, created_at: REG, updated_at: REG });
    await okAsync('case 1 early-registered onboarding: OLD misses, NEW catches after effective date', async () => {
      const o = { lastSyncedAt: LASTSYNC, start: Y0, end: '2099-03-11', codes: [c1] };
      assert.equal(await oldNeedsSync({ ...o, types: TYPES }), false, 'old should miss');
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-11' }), true, 'new should catch');
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-10', end: '2099-03-10' }), true, 'effective day itself');
      assert.equal(await newNeedsSync({ ...o, end: '2099-03-09', today: '2099-03-09' }), false, 'not yet effective -> skip');
    });
    await okAsync('case 1 monthly overview scope (month range + store scope)', async () => {
      const MT = ['resignation', 'onboarding', 'return_to_work', 'store_transfer', 'promotion', 'leave_without_pay', 'leave_of_absence'];
      const o = { lastSyncedAt: LASTSYNC, types: MT, start: '2099-03-01', end: '2099-03-31', codes: [c1], storeIds: [byCode.ZT01] };
      assert.equal(await oldNeedsSync(o), false, 'old should miss');
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-12' }), true, 'new should catch');
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-12', storeIds: [byCode.ZT02] }), false, 'other store scope -> skip');
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-12', start: '2099-04-01', end: '2099-04-30' }), false, 'other month -> skip');
    });

    // 情況 2：事後把「是否藥師」改為是（登錄在同步前、生效日已過、修改在同步後）
    const c2 = code(1);
    await insert({ employee_code: c2, movement_type: 'onboarding', movement_date: '2099-02-20', onboarding_is_pharmacist: true, created_at: REG, updated_at: '2099-03-02T03:00:00Z' });
    await okAsync('case 2 later edit (is_pharmacist -> true): OLD misses, NEW catches via updated_at', async () => {
      const o = { lastSyncedAt: LASTSYNC, start: Y0, end: '2099-03-05', codes: [c2] };
      assert.equal(await oldNeedsSync({ ...o, types: TYPES }), false, 'old should miss');
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-05' }), true, 'new should catch');
    });

    // 情況 3：提前登錄的離職
    const c3 = code(2);
    await insert({ employee_code: c3, movement_type: 'resignation', movement_date: '2099-03-20', created_at: REG, updated_at: REG });
    await okAsync('case 3 early-registered resignation: OLD misses, NEW catches on/after last working date', async () => {
      const o = { lastSyncedAt: LASTSYNC, start: Y0, end: '2099-03-21', codes: [c3] };
      assert.equal(await oldNeedsSync({ ...o, types: TYPES }), false, 'old should miss');
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-21' }), true, 'new should catch');
      assert.equal(await newNeedsSync({ ...o, end: '2099-03-19', today: '2099-03-19' }), false, 'before effective -> skip');
    });

    // 既有行為：新登錄仍會觸發
    const c4 = code(3);
    await insert({ employee_code: c4, movement_type: 'resignation', movement_date: '2099-02-10', created_at: '2099-03-02T00:00:00Z', updated_at: '2099-03-02T00:00:00Z' });
    await okAsync('(a) newly registered after last sync still triggers (old and new)', async () => {
      const o = { lastSyncedAt: LASTSYNC, start: Y0, end: '2099-03-05', codes: [c4] };
      assert.equal(await oldNeedsSync({ ...o, types: TYPES }), true);
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-05' }), true);
    });

    // 沒有變動：登錄在同步前、生效日在上次同步台灣日期當天或之前、未修改 -> 跳過
    const c5 = code(4);
    await insert({ employee_code: c5, movement_type: 'onboarding', movement_date: '2099-03-01', onboarding_is_pharmacist: true, created_at: REG, updated_at: REG });
    await insert({ employee_code: c5, movement_type: 'resignation', movement_date: '2099-02-15', created_at: REG, updated_at: REG });
    await okAsync('no change: skipped (not slowing the page) in OLD and NEW', async () => {
      const o = { lastSyncedAt: LASTSYNC, start: Y0, end: Y1, codes: [c5] };
      assert.equal(await oldNeedsSync({ ...o, types: TYPES }), false);
      assert.equal(await newNeedsSync({ ...o, today: '2099-06-30' }), false);
      assert.equal(await newNeedsSync({ ...o, today: '2099-03-01' }), false);
    });

    // 類型範圍外（promotion 不在年度主檔類型內）不觸發
    const c6 = code(5);
    await insert({ employee_code: c6, movement_type: 'promotion', movement_date: '2099-03-10', new_value: '店長', created_at: REG, updated_at: REG });
    await okAsync('movement type outside the original type list does not trigger', async () => {
      assert.equal(await newNeedsSync({ lastSyncedAt: LASTSYNC, today: '2099-03-11', start: Y0, end: '2099-03-11', codes: [c6] }), false);
    });

    // last_synced_at 以 "+00:00" 格式（資料庫回傳格式）傳入
    await okAsync('last_synced_at in "+00:00" format works', async () => {
      assert.equal(await newNeedsSync({ lastSyncedAt: '2099-03-01T10:00:00+00:00', today: '2099-03-11', start: Y0, end: '2099-03-11', codes: [c1] }), true);
    });
  } finally {
    if (created.length) {
      const { error } = await db.from('employee_movement_history').delete().in('id', created);
      if (error) {
        console.error('cleanup failed', error.message);
        process.exitCode = 1;
      }
    }
    const { count, error } = await db
      .from('employee_movement_history')
      .select('id', { count: 'exact', head: true })
      .in('id', created.length ? created : ['00000000-0000-0000-0000-000000000000']);
    const left = error ? 'unknown' : count;
    console.log(`  cleanup: created ${created.length} rows, residue ${left}`);
    if (left !== 0) process.exitCode = 1;
  }
}

(async () => {
  if (!process.argv.includes('--no-db')) await dbTests();
  console.log(`\n${passed} checks passed${process.exitCode ? ' (WITH FAILURES)' : ''}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
