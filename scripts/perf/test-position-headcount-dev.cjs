#!/usr/bin/env node
'use strict';
/**
 * 每月門市職位人數統計：DEV 整合測試。
 *
 * 載入真正的資料讀取模組（lib/monthly-staff/position-headcount-data.ts）與純函式，
 * 在 DEV 的測試門市（ZT01 / ZT02 / VW001 / ZT03）、保留月份 2099-03 / 2099-05 / 2099-07 建立測試人員狀態，
 * 驗證讀取結果與預期一致（含分頁超過 1000 筆、批次查詢次數、定稿判斷、趨勢），
 * 最後只用「自己建立的 id」刪除資料，並確認孤兒為 0。只連 DEV（ref 守衛在 dev-env.cjs）。
 *
 * 用法：node scripts/perf/test-position-headcount-dev.cjs
 */
const assert = require('node:assert/strict');
const { loadDevEnv } = require('./dev-env.cjs');
const { loadProjectModule, makeServiceClient } = require('./ms-harness.cjs');

const ENV = loadDevEnv();
const db = makeServiceClient(ENV);
const D = loadProjectModule('worktree', 'lib/monthly-staff/position-headcount-data.ts', {});
const H = loadProjectModule('worktree', 'lib/monthly-staff/position-headcount.ts', {});

const MONTHS = ['2099-03', '2099-05', '2099-07'];
const TEST_STORES = ['ZT01', 'ZT02', 'VW001', 'ZT03'];
const createdStatusIds = [];
const createdSummaryIds = [];

async function must(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  const stores = await must(db.from('stores').select('id, store_code, store_name').in('store_code', TEST_STORES));
  const sid = Object.fromEntries(stores.map((s) => [s.store_code, s.id]));
  for (const c of TEST_STORES) assert.ok(sid[c], `DEV 找不到測試門市 ${c}`);

  // 保留月份必須是空的，否則拒絕執行（避免誤算到別人的資料）
  for (const ym of MONTHS) {
    const { count } = await db.from('monthly_staff_status').select('id', { count: 'exact', head: true }).eq('year_month', ym);
    assert.equal(count, 0, `${ym} 已有資料，拒絕執行`);
    const { count: c2 } = await db.from('monthly_store_summary').select('id', { count: 'exact', head: true }).eq('year_month', ym);
    assert.equal(c2, 0, `${ym} 門市摘要已有資料，拒絕執行`);
  }

  const mk = (ym, store, code, position, o = {}) => ({
    year_month: ym,
    store_id: sid[store],
    employee_code: code,
    employee_name: `HC測試${code.slice(-3)}`,
    position,
    employment_type: 'full_time',
    monthly_status: 'full_month',
    status: 'draft',
    ...o,
  });
  const seed = [
    mk('2099-05', 'ZT01', 'HCT001', '店長'),
    mk('2099-05', 'ZT01', 'HCT002', '主任', { is_acting_manager: true }),
    mk('2099-05', 'ZT01', 'HCT003', '副店長'),
    mk('2099-05', 'ZT01', 'HCT004', '督導', { is_acting_manager: true }),
    mk('2099-05', 'ZT01', 'HCT005', '專員'),
    mk('2099-05', 'ZT01', 'HCT005', '專員'), // 同人同店同欄重複
    mk('2099-05', 'ZT01', 'HCT006', '組長'),
    mk('2099-05', 'ZT01', 'HCT007', '新人', { newbie_level: '未過階新人', monthly_status: 'new_hire' }),
    mk('2099-05', 'ZT01', 'HCT008', '新人', { newbie_level: '一階新人' }),
    mk('2099-05', 'ZT01', 'HCT009', '新人', { newbie_level: '二階新人' }),
    mk('2099-05', 'ZT01', 'HCT010', '行政', { newbie_level: '過階行政' }),
    mk('2099-05', 'ZT01', 'HCT011', '行政', { newbie_level: '未過階行政' }),
    mk('2099-05', 'ZT01', 'HCT012', '新人'), // 階段未登記
    mk('2099-05', 'ZT01', 'HCT013', '兼職助理', { employment_type: 'part_time' }),
    mk('2099-05', 'ZT01', 'HCT014', '專員', { monthly_status: 'resigned' }),
    mk('2099-05', 'ZT01', 'HCT015', '專員', { monthly_status: 'leave_of_absence' }),
    mk('2099-05', 'ZT02', 'HCT001', '店長-雙', { is_dual_position: true, monthly_status: 'dual_store_manager' }),
    mk('2099-05', 'ZT02', 'HCT016', '專員', { monthly_status: 'transferred_out' }),
    mk('2099-05', 'ZT02', 'HCT017', '專員'),
    mk('2099-05', 'ZT02', 'HCT018', '代理店長'),
    mk('2099-05', 'VW001', 'HCT016', '專員', { monthly_status: 'transferred_in' }),
    mk('2099-05', 'VW001', 'HCT017', '專員', { monthly_status: 'support_rotation' }),
    mk('2099-05', 'VW001', 'HCT019', '主任'),
    mk('2099-03', 'ZT01', 'HCT001', '店長'),
    mk('2099-03', 'ZT01', 'HCT005', '專員'),
  ];
  // 分頁測試：2099-07 在 ZT03 建 1100 筆（超過 Supabase 單頁 1000 筆上限）
  for (let i = 0; i < 1100; i++) seed.push(mk('2099-07', 'ZT03', `HCT7${String(i).padStart(4, '0')}`, '專員'));

  try {
    for (let i = 0; i < seed.length; i += 300) {
      const rows = await must(db.from('monthly_staff_status').insert(seed.slice(i, i + 300)).select('id'));
      createdStatusIds.push(...rows.map((r) => r.id));
    }
    const sums = await must(
      db.from('monthly_store_summary').insert([
        { year_month: '2099-05', store_id: sid.ZT01, store_status: 'confirmed' },
        { year_month: '2099-05', store_id: sid.ZT02, store_status: 'submitted' },
      ]).select('id'),
    );
    createdSummaryIds.push(...sums.map((r) => r.id));

    const results = [];
    const check = (name, fn) => {
      try {
        fn();
        results.push(`通過  ${name}`);
      } catch (e) {
        results.push(`失敗  ${name}\n      ${e.message.split('\n').join('\n      ')}`);
        process.exitCode = 1;
      }
    };

    // 計算呼叫資料庫的次數（確認是批次查詢，不是每門市一查）
    let fromCalls = 0;
    const counted = { from: (t) => { fromCalls += 1; return db.from(t); } };

    // ── 當月
    fromCalls = 0;
    const p5 = await D.loadPositionHeadcountData(counted, '2099-05', false);
    const callsMonth = fromCalls;
    const r5 = H.computeMonthHeadcount(p5.records, p5.stores, '2099-05');
    const cnt = (g, k) => g.people[k].length;

    check('2099-05 只讀到自己建立的 23 筆（含重複那筆）', () => assert.equal(p5.records.length, 23));
    check('批次查詢：當月讀取的資料表呼叫次數固定（門市/督導/人員/摘要各 1 次）', () => assert.equal(callsMonth, 4));
    check('全公司：各欄人數', () => {
      const g = r5.company;
      const exp = { admin_pass: 1, admin_not_pass: 1, newbie_0: 1, newbie_1: 1, newbie_2: 1, specialist: 3, leader: 1, director: 1, deputy: 1, acting: 2, manager: 1, supervisor: 1, other: 1, unregistered: 1 };
      for (const [k, n] of Object.entries(exp)) assert.equal(cnt(g, k), n, `${k}`);
      assert.equal(g.totalPeople, 17);
      assert.equal(g.actingBySupervisor.length, 1);
    });
    check('全公司：跨店店長取非雙那筆（ZT01）、標跨店', () => {
      const m = r5.company.people.manager[0];
      assert.equal(m.employee_code, 'HCT001');
      assert.equal(m.store_code, 'ZT01');
      assert.equal(m.crossStore, true);
    });
    check('各門市：ZT01=13、ZT02=3、VW001=2，加總 18 大於全公司 17（跨店）', () => {
      const flat = r5.areas.flatMap((a) => a.stores);
      const by = Object.fromEntries(flat.map((s) => [s.store.store_code, s.totalPeople]));
      assert.deepEqual(by, { ZT01: 13, ZT02: 3, VW001: 2 });
      assert.equal(flat.reduce((n, s) => n + s.totalPeople, 0), 18);
    });
    check('各門市：離職/留停/調出/支援卡班不計入、同人同店重複只算 1 次', () => {
      const flat = r5.areas.flatMap((a) => a.stores);
      const zt01 = flat.find((s) => s.store.store_code === 'ZT01');
      assert.equal(cnt(zt01, 'specialist'), 1);
      const vw = flat.find((s) => s.store.store_code === 'VW001');
      assert.equal(cnt(vw, 'specialist'), 1); // 只有調入的 HCT016
      assert.equal(vw.people.specialist[0].employee_code, 'HCT016');
      const ex = r5.excluded.map((e) => `${e.employee_code}:${e.monthly_status}`).sort();
      assert.deepEqual(ex, ['HCT014:resigned', 'HCT015:leave_of_absence', 'HCT016:transferred_out', 'HCT017:support_rotation']);
    });
    check('督導區：每間有資料的門市都在某個督導區內，且與讀到的督導對應一致', () => {
      const storeArea = new Map();
      for (const a of r5.areas) for (const s of a.stores) storeArea.set(s.store.store_code, a.key);
      assert.equal(storeArea.size, 3);
      for (const s of p5.stores.filter((x) => ['ZT01', 'ZT02', 'VW001'].includes(x.store_code))) {
        assert.equal(storeArea.get(s.store_code), s.supervisor_id || H.UNASSIGNED_AREA_KEY);
      }
      // 每區小計不超過其下門市加總，且不小於最大單店
      for (const a of r5.areas) {
        const sum = a.stores.reduce((n, s) => n + s.totalPeople, 0);
        assert.ok(a.subtotal.totalPeople <= sum);
        assert.ok(a.subtotal.totalPeople >= Math.max(...a.stores.map((s) => s.totalPeople)));
      }
    });
    check('定稿：ZT01 confirmed；ZT02（submitted）與 VW001（無摘要）列為未定稿', () => {
      assert.deepEqual(p5.unfinalizedStores.map((s) => s.store_code).sort(), ['VW001', 'ZT02']);
    });
    check('階段未登記名單與其他/兼職', () => {
      assert.equal(r5.company.people.unregistered[0].employee_code, 'HCT012');
      assert.equal(r5.company.people.other[0].position, '兼職助理');
      assert.equal(r5.unknownStatusPeople.length, 0);
    });
    check('Excel 列：全公司合計 17、明細含 4 筆不計入', () => {
      const { summaryRows, detailRows } = H.buildHeadcountExportRows(r5);
      assert.equal(summaryRows[0]['總人數'], 17);
      assert.equal(detailRows.filter((d) => d['是否計入'] === '否').length, 4);
    });

    // ── 趨勢（一次批次查詢 12 個月）
    fromCalls = 0;
    const pt = await D.loadPositionHeadcountData(counted, '2099-05', true);
    const callsTrend = fromCalls;
    const tr = H.computeHeadcountTrend(pt.records, pt.stores, '2099-05', 12);
    check('趨勢：查詢次數仍為 4（不是 12 倍）', () => assert.equal(callsTrend, 4));
    check('趨勢：12 個月、2098-06 ~ 2099-05；03 月 2 人、04 月無資料、05 月 17 人', () => {
      assert.equal(tr.length, 12);
      assert.equal(tr[0].yearMonth, '2098-06');
      assert.equal(tr[11].yearMonth, '2099-05');
      const by = Object.fromEntries(tr.map((x) => [x.yearMonth, x]));
      assert.equal(by['2099-03'].totalPeople, 2);
      assert.equal(by['2099-03'].counts.manager, 1);
      assert.equal(by['2099-04'].hasData, false);
      assert.equal(by['2099-05'].totalPeople, 17);
      assert.equal(by['2099-05'].counts.acting, 2);
    });

    // ── 分頁 > 1000
    const p7 = await D.loadPositionHeadcountData(db, '2099-07', false);
    check('分頁：2099-07 的 1100 筆全部讀到（超過單頁 1000 上限）', () => {
      assert.equal(p7.records.length, 1100);
      assert.equal(H.computeMonthHeadcount(p7.records, p7.stores, '2099-07').company.totalPeople, 1100);
    });

    // ── 輸入檢查
    let badErr = '';
    try {
      await D.loadPositionHeadcountData(db, '2099-13', false);
    } catch (e) {
      badErr = e.message;
    }
    check('月份格式錯誤會被拒絕', () => assert.match(badErr, /月份格式/));

    console.log(results.join('\n'));
  } finally {
    // 只刪自己建立的 id
    for (let i = 0; i < createdStatusIds.length; i += 200) {
      await db.from('monthly_staff_status').delete().in('id', createdStatusIds.slice(i, i + 200));
    }
    if (createdSummaryIds.length) await db.from('monthly_store_summary').delete().in('id', createdSummaryIds);
    // 孤兒檢查（唯讀）
    const { count: o1 } = await db.from('monthly_staff_status').select('id', { count: 'exact', head: true }).like('employee_code', 'HCT%');
    const { count: o2 } = await db.from('monthly_staff_status').select('id', { count: 'exact', head: true }).in('year_month', MONTHS);
    const { count: o3 } = await db.from('monthly_store_summary').select('id', { count: 'exact', head: true }).in('year_month', MONTHS);
    console.log(`孤兒檢查：人員狀態(員編 HCT%)=${o1}、人員狀態(保留月份)=${o2}、門市摘要(保留月份)=${o3}`);
    if (o1 || o2 || o3) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('測試中斷：', e.message);
  process.exit(1);
});
