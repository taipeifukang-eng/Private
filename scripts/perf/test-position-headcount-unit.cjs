#!/usr/bin/env node
'use strict';
/**
 * 每月門市職位人數統計（lib/monthly-staff/position-headcount.ts）表格驅動單元測試。不連資料庫。
 * 用法：node scripts/perf/test-position-headcount-unit.cjs
 */
const assert = require('node:assert/strict');
const { loadProjectModule } = require('./ms-harness.cjs');

const H = loadProjectModule('worktree', 'lib/monthly-staff/position-headcount.ts', {});
const A = loadProjectModule('worktree', 'lib/monthly-staff/employee-management-access.ts', {});

const YM = '2099-01';
const STORES = [
  { id: 's1', store_code: 'ZT01', store_name: '甲店', supervisor_id: 'u1', supervisor_name: '王督導' },
  { id: 's2', store_code: 'ZT02', store_name: '乙店', supervisor_id: 'u1', supervisor_name: '王督導' },
  { id: 's3', store_code: 'VW001', store_name: '丙店', supervisor_id: 'u2', supervisor_name: '李督導' },
  { id: 's4', store_code: 'VW002', store_name: '丁店', supervisor_id: null, supervisor_name: null },
];

let seq = 0;
function rec(o) {
  seq += 1;
  return {
    year_month: YM,
    store_id: 's1',
    employee_code: `T${String(seq).padStart(4, '0')}`,
    employee_name: `測試${seq}`,
    position: '專員',
    newbie_level: null,
    monthly_status: 'full_month',
    is_acting_manager: false,
    is_dual_position: false,
    employment_type: 'full_time',
    ...o,
  };
}

let passed = 0;
const failures = [];
function t(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`);
  }
}
const company = (records) => H.computeMonthHeadcount(records, STORES, YM).company;
const cnt = (g, k) => g.people[k].length;

// ── 1. 欄位歸類（每一欄）
const CLASSIFY = [
  ['行政 過階', { position: '行政', newbie_level: '過階行政' }, 'admin_pass'],
  ['行政 未過階', { position: '行政', newbie_level: '未過階行政' }, 'admin_not_pass'],
  ['新人 未過階', { position: '新人', newbie_level: '未過階新人' }, 'newbie_0'],
  ['新人 一階', { position: '新人', newbie_level: '一階新人' }, 'newbie_1'],
  ['新人 二階', { position: '新人', newbie_level: '二階新人' }, 'newbie_2'],
  ['專員', { position: '專員' }, 'specialist'],
  ['組長', { position: '組長' }, 'leader'],
  ['主任', { position: '主任' }, 'director'],
  ['副店長', { position: '副店長' }, 'deputy'],
  ['代理店長', { position: '代理店長' }, 'acting'],
  ['店長', { position: '店長' }, 'manager'],
  ['督導', { position: '督導' }, 'supervisor'],
  ['兼職助理 → 其他', { position: '兼職助理' }, 'other'],
  ['未知職位 → 其他', { position: '火星指揮官' }, 'other'],
  ['空白職位 → 其他', { position: '' }, 'other'],
  ['null 職位 → 其他', { position: null }, 'other'],
  ['資深專員 → 其他（不猜測）', { position: '資深專員' }, 'other'],
  ['新人 空白階段 → 階段未登記', { position: '新人', newbie_level: null }, 'unregistered'],
  ['新人 無法辨識階段 → 階段未登記', { position: '新人', newbie_level: '三階新人' }, 'unregistered'],
  ['行政 空白階段 → 階段未登記', { position: '行政', newbie_level: '' }, 'unregistered'],
  ['行政 無法辨識階段 → 階段未登記', { position: '行政', newbie_level: '亂寫' }, 'unregistered'],
  ['舊寫法 行政(過階)', { position: '行政(過階)' }, 'admin_pass'],
  ['舊寫法 行政(未過階)', { position: '行政(未過階)' }, 'admin_not_pass'],
  // 代理店長
  ['主任 + 代理 → 代理店長', { position: '主任', is_acting_manager: true }, 'acting'],
  ['副店長 + 代理 → 代理店長', { position: '副店長', is_acting_manager: true }, 'acting'],
  ['店長 + is_acting 旗標 → 仍是店長', { position: '店長', is_acting_manager: true }, 'manager'],
  // -雙 後綴
  ['店長-雙 → 店長', { position: '店長-雙' }, 'manager'],
  ['副店長-雙 → 副店長', { position: '副店長-雙' }, 'deputy'],
  ['主任-雙 + 代理 → 代理店長', { position: '主任-雙', is_acting_manager: true }, 'acting'],
  ['全形 － 雙後綴', { position: '專員－雙' }, 'specialist'],
  ['空白 -雙', { position: '組長 - 雙' }, 'leader'],
  ['督導-雙 → 督導', { position: '督導-雙' }, 'supervisor'],
];
for (const [name, o, col] of CLASSIFY) {
  t(`分類：${name}`, () => {
    const g = company([rec(o)]);
    assert.equal(cnt(g, col), 1, `應在 ${col}，實際 ${JSON.stringify(Object.fromEntries(H.HEADCOUNT_COLUMNS.map((c) => [c.key, cnt(g, c.key)]).filter(([, n]) => n)))}`);
    assert.equal(g.totalPeople, 1);
  });
}

t('分類：-雙 後綴後職位顯示為去除後的名稱', () => {
  const r = H.computeMonthHeadcount([rec({ position: '店長-雙' })], STORES, YM);
  assert.equal(r.storeEntries[0].position, '店長');
  assert.equal(r.storeEntries[0].isDual, true);
});

// ── 2. 代理店長不重複（主任/副店長代理只算代理店長）
t('代理：主任代理不同時出現在主任欄', () => {
  const g = company([rec({ position: '主任', is_acting_manager: true })]);
  assert.equal(cnt(g, 'director'), 0);
  assert.equal(cnt(g, 'acting'), 1);
  assert.equal(g.totalPeople, 1);
});
t('代理：副店長代理不同時出現在副店長欄', () => {
  const g = company([rec({ position: '副店長', is_acting_manager: true })]);
  assert.equal(cnt(g, 'deputy'), 0);
  assert.equal(cnt(g, 'acting'), 1);
});
t('代理：position=代理店長 與 主任代理 同店各一人 → 代理店長 2', () => {
  const g = company([rec({ position: '代理店長' }), rec({ position: '主任', is_acting_manager: true })]);
  assert.equal(cnt(g, 'acting'), 2);
  assert.equal(g.actingBySupervisor.length, 0);
});

// ── 3. 督導代理
t('督導代理：督導 + is_acting_manager → 算督導，不加進代理店長，標註 1 位由督導代理', () => {
  const g = company([rec({ position: '督導', is_acting_manager: true })]);
  assert.equal(cnt(g, 'supervisor'), 1);
  assert.equal(cnt(g, 'acting'), 0);
  assert.equal(g.actingBySupervisor.length, 1);
});
t('督導代理：position=督導(代理店長) 同上', () => {
  const g = company([rec({ position: '督導(代理店長)' })]);
  assert.equal(cnt(g, 'supervisor'), 1);
  assert.equal(cnt(g, 'acting'), 0);
  assert.equal(g.actingBySupervisor.length, 1);
});
t('督導代理：全形括號 督導（代理店長）', () => {
  const g = company([rec({ position: '督導（代理店長）' })]);
  assert.equal(cnt(g, 'supervisor'), 1);
  assert.equal(g.actingBySupervisor.length, 1);
});
t('督導代理：一般督導不標註', () => {
  const g = company([rec({ position: '督導' })]);
  assert.equal(g.actingBySupervisor.length, 0);
});
t('督導代理：混合 1 位代理店長 + 1 位督導代理', () => {
  const g = company([rec({ position: '代理店長' }), rec({ position: '督導(代理店長)' })]);
  assert.equal(cnt(g, 'acting'), 1);
  assert.equal(cnt(g, 'supervisor'), 1);
  assert.equal(g.actingBySupervisor.length, 1);
});

// ── 4. 月底在職判斷（每個 monthly_status）
const STATUS = [
  ['full_month', true], ['new_hire', true], ['transferred_in', true], ['promoted', true],
  ['leave_return', true], ['dual_store_manager', true],
  ['resigned', false], ['leave_of_absence', false], ['leave_without_pay', false],
  ['transferred_out', false], ['support_rotation', false],
];
for (const [st, counted] of STATUS) {
  t(`狀態：${st} ${counted ? '計入' : '不計入'}`, () => {
    const r = H.computeMonthHeadcount([rec({ monthly_status: st })], STORES, YM);
    assert.equal(r.company.totalPeople, counted ? 1 : 0);
    assert.equal(r.excluded.length, counted ? 0 : 1);
    if (!counted) assert.ok(r.excluded[0].excludedReason);
    assert.equal(r.unknownStatusPeople.length, 0);
  });
}
for (const bad of ['mystery', '', null, 'FULL_MONTH']) {
  t(`狀態：未知狀態 ${JSON.stringify(bad)} 計入並列入狀態待確認`, () => {
    const r = H.computeMonthHeadcount([rec({ monthly_status: bad })], STORES, YM);
    assert.equal(r.company.totalPeople, 1);
    assert.equal(r.unknownStatusPeople.length, 1);
    assert.equal(r.unknownStatusPeople[0].unknownStatus, true);
  });
}
t('狀態：調出（原店）+ 調入（新店）= 只在新店算 1 次，且不算跨店', () => {
  const r = H.computeMonthHeadcount(
    [rec({ employee_code: 'X1', store_id: 's1', monthly_status: 'transferred_out' }), rec({ employee_code: 'X1', store_id: 's2', monthly_status: 'transferred_in' })],
    STORES, YM,
  );
  assert.equal(r.company.totalPeople, 1);
  const s1 = r.areas[0].stores.find((s) => s.store.id === 's1');
  const s2 = r.areas[0].stores.find((s) => s.store.id === 's2');
  assert.equal(s1.totalPeople, 0);
  assert.equal(s2.totalPeople, 1);
  assert.equal(s2.people.specialist[0].crossStore, false);
});
t('狀態：支援卡班不算在被支援門市，只算原門市', () => {
  const r = H.computeMonthHeadcount(
    [rec({ employee_code: 'X2', store_id: 's1' }), rec({ employee_code: 'X2', store_id: 's3', monthly_status: 'support_rotation' })],
    STORES, YM,
  );
  const s3 = r.areas.flatMap((a) => a.stores).find((s) => s.store.id === 's3');
  assert.equal(s3.totalPeople, 0);
  assert.equal(r.company.totalPeople, 1);
});
t('月份：只算所選月份', () => {
  const g = company([rec({}), rec({ year_month: '2099-02' }), rec({ year_month: '2098-12' })]);
  assert.equal(g.totalPeople, 1);
});

// ── 5. 去重
t('去重：同人同店同欄多筆只算 1 次', () => {
  const r = H.computeMonthHeadcount([rec({ employee_code: 'D1' }), rec({ employee_code: 'D1' }), rec({ employee_code: 'd1 ' })], STORES, YM);
  assert.equal(r.company.totalPeople, 1);
  assert.equal(r.areas[0].stores[0].people.specialist.length, 1);
  assert.equal(r.storeEntries.length, 1);
});
t('去重：跨店（雙店長）全公司只算 1 次，取非雙那筆；各門市照實際登記顯示並標跨店', () => {
  const r = H.computeMonthHeadcount(
    [
      rec({ employee_code: 'M1', store_id: 's1', position: '店長' }),
      rec({ employee_code: 'M1', store_id: 's2', position: '店長-雙', is_dual_position: true, monthly_status: 'dual_store_manager' }),
    ],
    STORES, YM,
  );
  assert.equal(r.company.totalPeople, 1);
  assert.equal(cnt(r.company, 'manager'), 1);
  assert.equal(r.company.people.manager[0].store_code, 'ZT01');
  assert.equal(r.company.people.manager[0].isPrimary, true);
  const stores = r.areas[0].stores;
  assert.equal(stores[0].people.manager.length, 1);
  assert.equal(stores[1].people.manager.length, 1);
  assert.equal(stores[0].people.manager[0].crossStore, true);
  assert.equal(stores[1].people.manager[0].crossStore, true);
  // 同督導區小計：同人同欄只算 1 次，門市加總(2) > 小計(1)
  assert.equal(r.areas[0].subtotal.people.manager.length, 1);
});
t('去重：跨店且都非雙 → 取職等較高者', () => {
  const r = H.computeMonthHeadcount(
    [rec({ employee_code: 'M2', store_id: 's1', position: '專員' }), rec({ employee_code: 'M2', store_id: 's3', position: '組長' })],
    STORES, YM,
  );
  assert.equal(r.company.totalPeople, 1);
  assert.equal(cnt(r.company, 'leader'), 1);
  assert.equal(cnt(r.company, 'specialist'), 0);
});
t('去重：跨店同職等 → 取門市代號較小者（結果固定，與輸入順序無關）', () => {
  const a = [rec({ employee_code: 'M3', store_id: 's2' }), rec({ employee_code: 'M3', store_id: 's1' })];
  const r1 = H.computeMonthHeadcount(a, STORES, YM);
  const r2 = H.computeMonthHeadcount([...a].reverse(), STORES, YM);
  assert.equal(r1.company.people.specialist[0].store_code, 'ZT01');
  assert.equal(r2.company.people.specialist[0].store_code, 'ZT01');
});
t('去重：同人同店不同欄（專員 + 代理）門市層各欄都有，全公司只算 1 次（取職等高者）', () => {
  const r = H.computeMonthHeadcount(
    [rec({ employee_code: 'M4', position: '專員' }), rec({ employee_code: 'M4', position: '代理店長' })],
    STORES, YM,
  );
  assert.equal(r.company.totalPeople, 1);
  assert.equal(cnt(r.company, 'acting'), 1);
  assert.equal(r.areas[0].stores[0].totalPeople, 1);
});
t('去重：沒有員編者各算各的（以門市+姓名辨識）', () => {
  const g = company([rec({ employee_code: '', employee_name: '甲' }), rec({ employee_code: null, employee_name: '乙' }), rec({ employee_code: '', employee_name: '甲' })]);
  assert.equal(g.totalPeople, 2);
});

// ── 6. 督導區分組 / 小計
t('督導區：依 supervisor 分組、組內依門市代號排序、未分區排最後、小計正確', () => {
  const r = H.computeMonthHeadcount(
    [
      rec({ store_id: 's1' }), rec({ store_id: 's2' }), rec({ store_id: 's2', position: '店長' }),
      rec({ store_id: 's3' }), rec({ store_id: 's4' }),
    ],
    STORES, YM,
  );
  assert.equal(r.areas.length, 3);
  assert.equal(r.areas[2].name, '未分區');
  assert.deepEqual(r.areas.slice(0, 2).map((a) => a.name).sort(), ['李督導', '王督導'].sort());
  const wang = r.areas.find((a) => a.name === '王督導');
  assert.deepEqual(wang.stores.map((s) => s.store.store_code), ['ZT01', 'ZT02']);
  assert.equal(wang.subtotal.totalPeople, 3);
  assert.equal(r.company.totalPeople, 5);
});
t('督導區：沒有任何督導資料的門市歸未分區；未知門市 id 不會被丟掉', () => {
  const r = H.computeMonthHeadcount([rec({ store_id: 'zzz' })], STORES, YM);
  assert.equal(r.company.totalPeople, 1);
  assert.equal(r.areas[0].name, '未分區');
  assert.equal(r.areas[0].stores[0].store.store_name, '（未知門市）');
});

// ── 7. 階段未登記清單
t('階段未登記：只含新人/行政階段空白或無法辨識者，且不計入其他欄', () => {
  const g = company([rec({ position: '新人', newbie_level: null }), rec({ position: '行政', newbie_level: '?' }), rec({ position: '新人', newbie_level: '一階新人' })]);
  assert.equal(cnt(g, 'unregistered'), 2);
  assert.equal(cnt(g, 'newbie_1'), 1);
  assert.equal(g.totalPeople, 3);
});

// ── 8. 趨勢
t('趨勢：12 個月、以所選月份為結尾、跨年正確', () => {
  assert.deepEqual(H.monthsEndingAt('2099-02', 12), ['2098-03', '2098-04', '2098-05', '2098-06', '2098-07', '2098-08', '2098-09', '2098-10', '2098-11', '2098-12', '2099-01', '2099-02']);
});
t('趨勢：每月各欄人數、無資料月份 hasData=false、每月全公司去重', () => {
  const recs = [
    rec({ year_month: '2099-01', employee_code: 'A1', position: '店長' }),
    rec({ year_month: '2099-01', employee_code: 'A1', position: '店長-雙', store_id: 's2', is_dual_position: true }),
    rec({ year_month: '2099-01', employee_code: 'A2', position: '新人', newbie_level: '一階新人' }),
    rec({ year_month: '2099-03', employee_code: 'A1', position: '店長' }),
    rec({ year_month: '2099-03', employee_code: 'A3', position: '督導', is_acting_manager: true }),
    rec({ year_month: '2099-03', employee_code: 'A4', monthly_status: 'resigned' }),
    rec({ year_month: '2097-12', employee_code: 'A9' }), // 超出 12 個月視窗
  ];
  const tr = H.computeHeadcountTrend(recs, STORES, '2099-03', 12);
  assert.equal(tr.length, 12);
  assert.equal(tr[0].yearMonth, '2098-04');
  assert.equal(tr[11].yearMonth, '2099-03');
  const jan = tr.find((x) => x.yearMonth === '2099-01');
  const feb = tr.find((x) => x.yearMonth === '2099-02');
  const mar = tr.find((x) => x.yearMonth === '2099-03');
  assert.equal(jan.counts.manager, 1);
  assert.equal(jan.counts.newbie_1, 1);
  assert.equal(jan.totalPeople, 2);
  assert.equal(feb.hasData, false);
  assert.equal(feb.totalPeople, 0);
  assert.equal(mar.counts.manager, 1);
  assert.equal(mar.counts.supervisor, 1);
  assert.equal(mar.actingBySupervisor, 1);
  assert.equal(mar.totalPeople, 2);
  assert.equal(tr.reduce((s, x) => s + x.totalPeople, 0), 4);
});

// ── 9. 定稿
t('定稿：只有 confirmed 算定稿；有資料但無摘要或非 confirmed 為未定稿', () => {
  const recs = [rec({ store_id: 's1' }), rec({ store_id: 's2' }), rec({ store_id: 's3' }), rec({ store_id: 's4', year_month: '2099-02' })];
  const un = H.findUnfinalizedStores(recs, STORES, [{ store_id: 's1', store_status: 'confirmed' }, { store_id: 's2', store_status: 'submitted' }], YM);
  assert.deepEqual(un.map((s) => s.store_code), ['ZT02', 'VW001'].sort((a, b) => a.localeCompare(b)));
});
t('定稿：全部 confirmed → 空', () => {
  const un = H.findUnfinalizedStores([rec({ store_id: 's1' })], STORES, [{ store_id: 's1', store_status: 'confirmed' }], YM);
  assert.equal(un.length, 0);
});

// ── 10. Excel 列
t('匯出：人數統計首列為全公司合計、人員明細含不計入者與備註', () => {
  const r = H.computeMonthHeadcount(
    [
      rec({ employee_code: 'E1', store_id: 's1', position: '店長' }),
      rec({ employee_code: 'E1', store_id: 's2', position: '店長-雙', is_dual_position: true }),
      rec({ employee_code: 'E2', monthly_status: 'resigned' }),
      rec({ employee_code: 'E3', monthly_status: 'weird' }),
    ],
    STORES, YM,
  );
  const { summaryRows, detailRows } = H.buildHeadcountExportRows(r);
  assert.equal(summaryRows[0]['督導區'], '全公司');
  assert.equal(summaryRows[0]['店長'], 1);
  assert.equal(summaryRows[0]['總人數'], 2);
  const e2 = detailRows.find((d) => d['員編'] === 'E2');
  assert.equal(e2['是否計入'], '否');
  assert.match(e2['不計入原因'], /離職/);
  assert.match(detailRows.find((d) => d['員編'] === 'E3')['備註'], /狀態待確認/);
  assert.match(detailRows.find((d) => d['員編'] === 'E1' && d['門市代號'] === 'ZT02')['備註'], /跨店/);
});

// ── 10b. 督導卡班（is_supervisor_rotation）
const ROT = (o) => rec({ position: '督導', is_supervisor_rotation: true, ...o });
t('督導卡班：(a) 卡班列不計入任何層級，列在不計入名單，原因「督導卡班」', () => {
  const r = H.computeMonthHeadcount([ROT({ employee_code: 'R1', store_id: 's1' }), rec({ employee_code: 'N1', store_id: 's1' })], STORES, YM);
  assert.equal(cnt(r.company, 'supervisor'), 0);
  assert.equal(r.company.totalPeople, 1);
  assert.equal(r.areas[0].stores[0].totalPeople, 1);
  assert.equal(r.areas[0].subtotal.totalPeople, 1);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].employee_code, 'R1');
  assert.equal(r.excluded[0].excludedReason, '督導卡班');
  assert.equal(r.storeEntries.some((e) => e.employee_code === 'R1'), false);
});
t('督導卡班：(b) 同督導同月另一門市正常列照常計入，全公司只算一次', () => {
  const r = H.computeMonthHeadcount(
    [ROT({ employee_code: 'R2', store_id: 's1' }), rec({ employee_code: 'R2', store_id: 's3', position: '督導' })],
    STORES, YM,
  );
  assert.equal(r.company.totalPeople, 1);
  assert.equal(cnt(r.company, 'supervisor'), 1);
  assert.equal(r.company.people.supervisor[0].store_code, 'VW001');
  const s1 = r.areas.find((a) => a.name === '王督導').stores[0];
  assert.equal(s1.totalPeople, 0);
  assert.equal(r.areas.find((a) => a.name === '李督導').stores[0].totalPeople, 1);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.company.people.supervisor[0].crossStore, false);
});
t('督導卡班：(c) 卡班 + 代理店長 → 不計入人數，代理店長欄標註 N 位並可看名單', () => {
  const r = H.computeMonthHeadcount(
    [
      ROT({ employee_code: 'R3', store_id: 's1', is_acting_manager: true }),
      ROT({ employee_code: 'R4', store_id: 's1', position: '督導(代理店長)' }),
      ROT({ employee_code: 'R5', store_id: 's1' }),
      rec({ employee_code: 'A1', store_id: 's1', position: '代理店長' }),
      rec({ employee_code: 'R3', store_id: 's2', position: '專員' }),
    ],
    STORES, YM,
  );
  const st = r.areas[0].stores[0];
  assert.equal(cnt(st, 'acting'), 1);
  assert.equal(cnt(st, 'supervisor'), 0);
  assert.equal(st.actingBySupervisor.length, 0);
  assert.deepEqual(st.rotationActing.map((e) => e.employee_code).sort(), ['R3', 'R4']);
  assert.equal(r.areas[0].subtotal.rotationActing.length, 2);
  assert.equal(r.company.rotationActing.length, 2);
  assert.equal(r.areas[0].stores[1].rotationActing.length, 0);
  assert.equal(r.company.totalPeople, 2); // A1 + R3（乙店專員）
});
t('督導卡班：(c2) 同一人兩間門市都卡班代理，全公司標註只算 1 位', () => {
  const r = H.computeMonthHeadcount(
    [ROT({ employee_code: 'R6', store_id: 's1', is_acting_manager: true }), ROT({ employee_code: 'R6', store_id: 's2', is_acting_manager: true })],
    STORES, YM,
  );
  assert.equal(r.company.rotationActing.length, 1);
  assert.equal(r.areas[0].subtotal.rotationActing.length, 1);
  assert.equal(r.company.totalPeople, 0);
});
t('督導卡班：(d) monthly_status 為 full_month 也排除（卡班優先）', () => {
  const r = H.computeMonthHeadcount([ROT({ employee_code: 'R7', monthly_status: 'full_month' })], STORES, YM);
  assert.equal(r.company.totalPeople, 0);
  assert.equal(r.excluded[0].excludedReason, '督導卡班');
  assert.equal(r.unknownStatusPeople.length, 0);
});
t('督導卡班：(d2) 狀態空白的卡班列不列入狀態待確認', () => {
  const r = H.computeMonthHeadcount([ROT({ employee_code: 'R8', monthly_status: '' })], STORES, YM);
  assert.equal(r.unknownStatusPeople.length, 0);
  assert.equal(r.excluded.length, 1);
});
t('督導卡班：is_supervisor_rotation=false/null 不受影響', () => {
  const g = company([rec({ position: '督導', is_supervisor_rotation: false }), rec({ position: '督導', is_supervisor_rotation: null })]);
  assert.equal(cnt(g, 'supervisor'), 2);
  assert.equal(g.rotationActing.length, 0);
});
t('督導卡班：(e) 趨勢套用（不計入、卡班代理另列）', () => {
  const recs = [
    ROT({ employee_code: 'T1', year_month: '2099-01', is_acting_manager: true }),
    rec({ employee_code: 'T2', year_month: '2099-01' }),
    ROT({ employee_code: 'T3', year_month: '2099-02' }),
  ];
  const tr = H.computeHeadcountTrend(recs, STORES, '2099-02', 3);
  const jan = tr.find((x) => x.yearMonth === '2099-01');
  const feb = tr.find((x) => x.yearMonth === '2099-02');
  assert.equal(jan.totalPeople, 1);
  assert.equal(jan.counts.supervisor, 0);
  assert.equal(jan.rotationActing, 1);
  assert.equal(feb.totalPeople, 0);
  assert.equal(feb.counts.supervisor, 0);
  assert.equal(feb.hasData, true);
});
t('督導卡班：(f) 匯出列 — 統計列不計入、代理標註欄、明細看得出督導卡班', () => {
  const r = H.computeMonthHeadcount(
    [ROT({ employee_code: 'X1', store_id: 's1', is_acting_manager: true }), rec({ employee_code: 'X2', store_id: 's1' })],
    STORES, YM,
  );
  const { summaryRows, detailRows } = H.buildHeadcountExportRows(r);
  assert.equal(summaryRows[0]['督導'], 0);
  assert.equal(summaryRows[0]['總人數'], 1);
  assert.equal(summaryRows[0]['督導卡班代理（不計入）'], 1);
  const d = detailRows.find((x) => x['員編'] === 'X1');
  assert.equal(d['是否計入'], '否');
  assert.equal(d['不計入原因'], '督導卡班');
  assert.match(d['備註'], /督導卡班/);
  assert.match(d['備註'], /督導卡班代理店長/);
});

// ── 11. 權限（與員工管理頁相同）
const ACCESS = [
  ['admin', { role: 'admin' }, true],
  ['營業部 member 助理', { role: 'member', department: '營業部', job_title: '助理' }, true],
  ['營業部 manager 主管', { role: 'manager', department: '營業一部', job_title: '經理' }, true],
  ['營業部 member 但職稱店長', { role: 'member', department: '營業部', job_title: '店長' }, false],
  ['營業部 manager 但職稱督導', { role: 'manager', department: '營業部', job_title: '督導' }, false],
  ['營業部 manager 職稱督導(代理店長)', { role: 'manager', department: '營業部', job_title: '督導(代理店長)' }, false],
  ['非營業部 member', { role: 'member', department: '行政部', job_title: '助理' }, false],
  ['非營業部 manager', { role: 'manager', department: '人資部' }, false],
  ['supervisor 角色', { role: 'supervisor', department: '營業部' }, false],
  ['Admin 大小寫不同', { role: 'Admin' }, false],
  ['null profile', null, false],
  ['undefined profile', undefined, false],
];
for (const [name, p, ok] of ACCESS) {
  t(`權限：${name} → ${ok ? '可看' : '不可看'}`, () => assert.equal(A.canViewEmployeeManagement(p), ok));
}

t('未定稿橫幅：payload 月份與所選月份相同才顯示', () => {
  const payload = { yearMonth: '2026-10', unfinalizedStores: STORES.slice(0, 3) };
  assert.equal(H.unfinalizedStoresForMonth(payload, '2026-10').length, 3);
});
t('未定稿橫幅：切換月份讀取中（舊 payload）不顯示上月名單', () => {
  const payload = { yearMonth: '2026-10', unfinalizedStores: STORES.slice(0, 3) };
  assert.deepEqual(H.unfinalizedStoresForMonth(payload, '2026-09'), []);
});
t('未定稿橫幅：payload 為 null 回傳空', () => assert.deepEqual(H.unfinalizedStoresForMonth(null, '2026-09'), []));

t('匯出欄寬：每個表頭都有對應寬度，卡班代理欄不被擠壓、總人數維持 10', () => {
  const r = H.computeMonthHeadcount([rec({ position: '專員' })], STORES, YM);
  const headers = Object.keys(H.buildHeadcountExportRows(r).summaryRows[0]);
  const w = H.summarySheetColumnWidths(headers);
  assert.equal(w.length, headers.length);
  assert.ok(w[headers.indexOf('督導卡班代理（不計入）')].wch >= 22);
  assert.equal(w[headers.indexOf('總人數')].wch, 10);
  assert.equal(w[headers.indexOf('其中由督導代理店長')].wch, 18);
});

console.log(`通過 ${passed} 項`);
if (failures.length) {
  console.error(`失敗 ${failures.length} 項：\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('全部通過');
