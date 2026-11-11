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

const MONTHS = ['2038-06', '2038-07', '2038-08', '2099-03', '2099-05', '2099-07', '2099-09'];
const TEST_STORES = ['ZT01', 'ZT02', 'VW001', 'ZT03'];
const createdStatusIds = [];
const createdSummaryIds = [];
let franchiseBackup = null; // 測試門市 is_franchise 原值，結束還原

async function must(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function main() {
  const stores = await must(db.from('stores').select('id, store_code, store_name, is_franchise').in('store_code', TEST_STORES));
  franchiseBackup = stores.map((s) => ({ id: s.id, is_franchise: s.is_franchise }));
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
  // 督導卡班（2099-09）：卡班列不計入；同督導另一門市正常列照常計入；卡班+代理店長只標註；full_month 也排除
  seed.push(
    mk('2099-09', 'ZT01', 'HCT901', '督導', { is_supervisor_rotation: true }),
    mk('2099-09', 'VW001', 'HCT901', '督導'),
    mk('2099-09', 'ZT02', 'HCT902', '督導', { is_supervisor_rotation: true, is_acting_manager: true }),
    mk('2099-09', 'ZT01', 'HCT903', '專員'),
  );
  // 跨店主要歸屬（2038-06）：同一督導在 VW001（普通）與 ZT02（督導(代理店長)）都有登記 → 只算 ZT02（代理優先，即使不是代號最小）
  seed.push(
    mk('2038-06', 'VW001', 'HCT801', '督導'),
    mk('2038-06', 'ZT02', 'HCT801', '督導(代理店長)'),
    mk('2038-06', 'ZT01', 'HCT802', '專員'),
  );
  // 加盟店篩選（2038-07）：ZT01 設加盟，ZT02/VW001 設直營
  seed.push(
    mk('2038-07', 'ZT01', 'HCT811', '專員'),
    mk('2038-07', 'ZT02', 'HCT812', '專員'),
    mk('2038-07', 'VW001', 'HCT813', '專員'),
    mk('2038-07', 'ZT01', 'HCT814', '專員'), mk('2038-07', 'ZT02', 'HCT814', '組長'), // 主要 ZT02（直營）
    mk('2038-07', 'ZT01', 'HCT815', '組長'), mk('2038-07', 'VW001', 'HCT815', '專員'), // 主要 ZT01（加盟）
    mk('2038-07', 'ZT01', 'HCT816', '專員', { monthly_status: 'resigned' }),
  );
  // 審查修正（2038-08）：卡班代理在加盟 ZT01、人另有計入在直營 ZT02；專員跨店主要在直營 → ZT01 只剩被隱藏的人
  seed.push(
    mk('2038-08', 'ZT01', 'HCT901', '督導', { is_supervisor_rotation: true, is_acting_manager: true }), mk('2038-08', 'ZT02', 'HCT901', '督導'),
    mk('2038-08', 'ZT01', 'HCT902', '專員'), mk('2038-08', 'ZT02', 'HCT902', '組長'),
  );
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
    check('各門市：ZT01=13、ZT02=2、VW001=2，加總 17 = 全公司 17（跨店只算主要歸屬一間）', () => {
      const flat = r5.areas.flatMap((a) => a.stores);
      const by = Object.fromEntries(flat.map((s) => [s.store.store_code, s.totalPeople]));
      assert.deepEqual(by, { ZT01: 13, ZT02: 2, VW001: 2 });
      assert.equal(flat.reduce((n, s) => n + s.totalPeople, 0), 17);
    });
    check('各門市：離職/留停/調出/支援卡班不計入、同人同店重複只算 1 次', () => {
      const flat = r5.areas.flatMap((a) => a.stores);
      const zt01 = flat.find((s) => s.store.store_code === 'ZT01');
      assert.equal(cnt(zt01, 'specialist'), 1);
      const vw = flat.find((s) => s.store.store_code === 'VW001');
      assert.equal(cnt(vw, 'specialist'), 1); // 只有調入的 HCT016
      assert.equal(vw.people.specialist[0].employee_code, 'HCT016');
      const ex = r5.excluded.map((e) => `${e.employee_code}:${e.monthly_status}`).sort();
      // 新規則：HCT001 在 ZT02 的雙店長登記改列不計入（已計入 ZT01）
      assert.deepEqual(ex, ['HCT001:dual_store_manager', 'HCT014:resigned', 'HCT015:leave_of_absence', 'HCT016:transferred_out', 'HCT017:support_rotation']);
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
    check('Excel 列：全公司合計 17、明細含 5 筆不計入（含 HCT001 已計入 ZT01）', () => {
      const { summaryRows, detailRows } = H.buildHeadcountExportRows(r5);
      assert.equal(summaryRows[0]['總人數'], 17);
      assert.equal(detailRows.filter((d) => d['是否計入'] === '否').length, 5);
      assert.ok(detailRows.some((d) => d['員編'] === 'HCT001' && d['是否計入'] === '否' && /^已計入 ZT01/.test(d['不計入原因'])));
    });

    // ── 督導卡班
    const p9 = await D.loadPositionHeadcountData(db, '2099-09', false);
    const r9 = H.computeMonthHeadcount(p9.records, p9.stores, '2099-09');
    check('督導卡班：資料讀取帶回 is_supervisor_rotation 欄位', () => {
      assert.equal(p9.records.length, 4);
      assert.equal(p9.records.filter((r) => r.is_supervisor_rotation === true).length, 2);
    });
    check('督導卡班：卡班列不計入，列在不計入名單（原因督導卡班）；全公司 2 人（HCT901 只算一次 + HCT903）', () => {
      assert.equal(r9.company.totalPeople, 2);
      assert.equal(cnt(r9.company, 'supervisor'), 1);
      assert.equal(r9.company.people.supervisor[0].store_code, 'VW001');
      assert.deepEqual(r9.excluded.map((e) => `${e.employee_code}:${e.excludedReason}`).sort(), ['HCT901:督導卡班', 'HCT902:督導卡班']);
    });
    check('督導卡班：卡班代理店長只標註（全公司 1 位），不加進代理店長人數', () => {
      assert.equal(r9.company.rotationActing.length, 1);
      assert.equal(r9.company.rotationActing[0].employee_code, 'HCT902');
      assert.equal(cnt(r9.company, 'acting'), 0);
    });
    check('督導卡班：Excel 明細看得出督導卡班', () => {
      const { detailRows } = H.buildHeadcountExportRows(r9);
      assert.equal(detailRows.filter((d) => String(d['不計入原因']).startsWith('督導卡班')).length, 2);
    });

    // ── 跨店主要歸屬：督導兩店登記（其中一店代理）
    const p38 = await D.loadPositionHeadcountData(db, '2038-06', false);
    const r38 = H.computeMonthHeadcount(p38.records, p38.stores, '2038-06');
    check('跨店主要歸屬：只在代理那間（ZT02）計入，另一間（VW001）在不計入名單、原因「已計入 ZT02 …」', () => {
      const flat = r38.areas.flatMap((a) => a.stores);
      const where = flat.filter((s) => Object.values(s.people).some((l) => l.some((e) => e.employee_code === 'HCT801'))).map((s) => s.store.store_code);
      assert.deepEqual(where, ['ZT02']);
      const ex = r38.excluded.filter((e) => e.employee_code === 'HCT801');
      assert.equal(ex.length, 1);
      assert.equal(ex[0].store_code, 'VW001');
      const zt02 = p38.stores.find((s) => s.store_code === 'ZT02');
      assert.equal(H.excludedReasonLabel(ex[0]), `已計入 ${zt02.store_code} ${zt02.store_name}`.trim());
      assert.equal(r38.company.totalPeople, 2);
      assert.equal(r38.company.actingBySupervisor.length, 1);
    });
    check('跨店主要歸屬：三層加總一致、Excel 明細有不計入原因', () => {
      let sum = 0;
      for (const a of r38.areas) {
        assert.equal(a.stores.reduce((n, s) => n + s.totalPeople, 0), a.subtotal.totalPeople);
        sum += a.subtotal.totalPeople;
      }
      assert.equal(sum, r38.company.totalPeople);
      const { detailRows } = H.buildHeadcountExportRows(r38);
      assert.ok(detailRows.some((d) => d['員編'] === 'HCT801' && d['是否計入'] === '否' && /^已計入 ZT02/.test(d['不計入原因'])));
    });

    // ── 加盟店篩選（DEV：暫時設定 is_franchise，結束還原原值）
    const upd = await must(db.from('stores').update({ is_franchise: true }).eq('id', sid.ZT01).select('id'));
    assert.equal(upd.length, 1, '設定 ZT01 加盟失敗');
    const upd2 = await must(db.from('stores').update({ is_franchise: false }).in('id', [sid.ZT02, sid.VW001]).select('id'));
    assert.equal(upd2.length, 2, '設定 ZT02/VW001 直營失敗');
    const pa = await D.loadPositionHeadcountData(db, '2038-07', true, 'all');
    const po = await D.loadPositionHeadcountData(db, '2038-07', true, 'only');
    const px = await D.loadPositionHeadcountData(db, '2038-07', true, 'exclude');
    const pd = await D.loadPositionHeadcountData(db, '2038-07', true);
    const rAll = H.computeMonthHeadcount(pa.records, pa.stores, '2038-07');
    const rOnly = H.computeMonthHeadcount(po.records, po.stores, '2038-07');
    const rEx = H.computeMonthHeadcount(px.records, px.stores, '2038-07');
    const mine = (r) => r.storeEntries.map((e) => e.employee_code).filter((c) => c.startsWith('HCT8')).sort();
    check('篩選：不帶參數 = all，payload 標明 franchise', () => {
      assert.equal(pd.franchise, 'all');
      assert.equal(po.franchise, 'only');
      assert.equal(px.franchise, 'exclude');
      assert.equal(pd.records.length, pa.records.length);
    });
    check('篩選：stores 帶回 is_franchise（ZT01 加盟、ZT02 直營）', () => {
      assert.equal(pa.stores.find((s) => s.store_code === 'ZT01').is_franchise, true);
      assert.equal(pa.stores.find((s) => s.store_code === 'ZT02').is_franchise, false);
    });
    check('篩選 all：HCT811~815 各算一次（5 人）', () => {
      assert.deepEqual(mine(rAll), ['HCT811', 'HCT812', 'HCT813', 'HCT814', 'HCT815']);
      assert.equal(rAll.company.totalPeople, 5);
    });
    check('只看加盟店：只有 ZT01 的 HCT811、HCT815（HCT814 主要在直營，不出現）', () => {
      assert.deepEqual(mine(rOnly), ['HCT811', 'HCT815']);
      assert.equal(rOnly.company.totalPeople, 2);
      assert.ok(![...rOnly.storeEntries, ...rOnly.excluded].some((e) => e.employee_code === 'HCT814'));
      assert.deepEqual(rOnly.areas.flatMap((a) => a.stores).map((s) => s.store.store_code), ['ZT01']);
    });
    check('不含加盟店：HCT812、HCT813、HCT814（HCT815、離職的 HCT816 不出現）', () => {
      assert.deepEqual(mine(rEx), ['HCT812', 'HCT813', 'HCT814']);
      assert.equal(rEx.company.totalPeople, 3);
      assert.ok(![...rEx.storeEntries, ...rEx.excluded].some((e) => e.employee_code === 'HCT815' || e.employee_code === 'HCT816'));
    });
    check('只看加盟 + 不含加盟 = 全部：每欄人數、總人數恆等', () => {
      for (const c of H.HEADCOUNT_COLUMNS) assert.equal(cnt(rOnly.company, c.key) + cnt(rEx.company, c.key), cnt(rAll.company, c.key), c.key);
      assert.equal(rOnly.company.totalPeople + rEx.company.totalPeople, rAll.company.totalPeople);
    });
    check('篩選：三層加總一致（每種模式）', () => {
      for (const r of [rAll, rOnly, rEx]) {
        let sum = 0;
        for (const a of r.areas) {
          assert.equal(a.stores.reduce((n, s) => n + s.totalPeople, 0), a.subtotal.totalPeople);
          sum += a.subtotal.totalPeople;
        }
        assert.equal(sum, r.company.totalPeople);
      }
    });
    check('篩選：趨勢跟著篩選且恆等；未定稿門市只含留下的門市', () => {
      const pick = (p) => H.computeHeadcountTrend(p.records, p.stores, '2038-07', 12).find((x) => x.yearMonth === '2038-07');
      const ta = pick(pa);
      const to = pick(po);
      const tx = pick(px);
      assert.equal(ta.totalPeople, 5);
      assert.equal(to.totalPeople + tx.totalPeople, ta.totalPeople);
      for (const c of H.HEADCOUNT_COLUMNS) assert.equal(to.counts[c.key] + tx.counts[c.key], ta.counts[c.key], c.key);
      assert.deepEqual(po.unfinalizedStores.map((s) => s.store_code), ['ZT01']);
      assert.deepEqual(px.unfinalizedStores.map((s) => s.store_code).sort(), ['VW001', 'ZT02']);
    });
    const q8 = await Promise.all(['all', 'only', 'exclude'].map((f) => D.loadPositionHeadcountData(db, '2038-08', false, f)));
    const [r8a, r8o, r8x] = q8.map((p) => H.computeMonthHeadcount(p.records, p.stores, '2038-08'));
    check('篩選 2038-08：卡班代理欄與各欄恆等', () => {
      assert.equal(r8a.company.rotationActing.length, 1);
      assert.equal(r8o.company.rotationActing.length, 1);
      assert.equal(r8x.company.rotationActing.length, 0);
      for (const c of H.HEADCOUNT_COLUMNS) assert.equal(cnt(r8o.company, c.key) + cnt(r8x.company, c.key), cnt(r8a.company, c.key), c.key);
      assert.equal(r8o.company.totalPeople + r8x.company.totalPeople, r8a.company.totalPeople);
      assert.equal(r8o.company.actingBySupervisor.length + r8x.company.actingBySupervisor.length, r8a.company.actingBySupervisor.length);
    });
    check('篩選 2038-08：只剩被隱藏的人的門市，未定稿清單仍照列（只看＋不含＝全部）', () => {
      const codes = (p) => p.unfinalizedStores.map((s) => s.store_code).filter((c) => c === 'ZT01' || c === 'ZT02').sort();
      assert.deepEqual(codes(q8[0]), ['ZT01', 'ZT02']);
      assert.deepEqual(codes(q8[1]), ['ZT01']);
      assert.deepEqual(codes(q8[2]), ['ZT02']);
    });
    check('篩選：Excel 三種檔名、合計列名稱、實際寫出並讀回', () => {
      const XLSX = require('xlsx');
      const exp = { all: ['每月職位人數統計_2038-07.xlsx', '全公司'], only: ['每月職位人數統計_2038-07_只看加盟店.xlsx', '加盟店合計'], exclude: ['每月職位人數統計_2038-07_不含加盟店.xlsx', '直營店合計'] };
      for (const [f, r] of [['all', rAll], ['only', rOnly], ['exclude', rEx]]) {
        assert.equal(H.headcountExportFileName('2038-07', f), exp[f][0]);
        const { summaryRows, detailRows } = H.buildHeadcountExportRows(r, f);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), '人數統計');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), '人員明細');
        const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(back.Sheets['人數統計']);
        assert.equal(rows[0]['督導區'], exp[f][1]);
        assert.equal(rows[0]['總人數'], r.company.totalPeople);
      }
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
    // 還原測試門市 is_franchise 原值
    for (const b of franchiseBackup || []) {
      const { error: restoreErr } = await db.from('stores').update({ is_franchise: b.is_franchise }).eq('id', b.id);
      if (restoreErr) {
        console.error(`還原 is_franchise 失敗（${b.id}）：${restoreErr.message}`);
        process.exitCode = 1;
      }
    }
    // 只刪自己建立的 id
    for (let i = 0; i < createdStatusIds.length; i += 200) {
      await db.from('monthly_staff_status').delete().in('id', createdStatusIds.slice(i, i + 200));
    }
    if (createdSummaryIds.length) await db.from('monthly_store_summary').delete().in('id', createdSummaryIds);
    // 孤兒檢查（唯讀）
    const { count: o1 } = await db.from('monthly_staff_status').select('id', { count: 'exact', head: true }).like('employee_code', 'HCT%');
    const { count: o2 } = await db.from('monthly_staff_status').select('id', { count: 'exact', head: true }).in('year_month', MONTHS);
    const { count: o3 } = await db.from('monthly_store_summary').select('id', { count: 'exact', head: true }).in('year_month', MONTHS);
    if (franchiseBackup) {
      const { data: now } = await db.from('stores').select('id, is_franchise').in('id', franchiseBackup.map((b) => b.id));
      const bad = (now || []).filter((n) => n.is_franchise !== franchiseBackup.find((b) => b.id === n.id).is_franchise);
      console.log(`is_franchise 還原檢查：${bad.length === 0 ? '全部已還原原值' : '未還原 ' + bad.length + ' 間'}`);
      if (bad.length) process.exitCode = 1;
    }
    console.log(`孤兒檢查：人員狀態(員編 HCT%)=${o1}、人員狀態(保留月份)=${o2}、門市摘要(保留月份)=${o3}`);
    if (o1 || o2 || o3) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('測試中斷：', e.message);
  process.exit(1);
});
