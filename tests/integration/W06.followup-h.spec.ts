import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import {
  W06_MONTHS,
  adjustmentsOf,
  adminDb,
  historyOf,
  insertHistory,
  masterOf,
  purgeReceipts,
  purgeW06,
  recheckOf,
  recompute,
  registerW06,
  rosterRows,
  seedMaster,
  seedRoster,
  storeName,
  submitMovements,
  w06Code,
  w06StoreIds,
} from '../support/w06-fixtures';

// W06 整合層（M2 後續問卷 H.4、H.5、H.9）：回讀資料庫驗證。
//   H.4 員工主檔階段跟著升職異動（新增、修改、刪除恢復）自動更新；調店帶到新店主檔；員工清單與編輯 API 回傳階段。
//   H.5 代理店長註記在升職為店長、調店、離職、留停時自動結束（該月起名冊不標代理），同日較晚登記的新店代理不被結束。
//   H.9 修改異動姓名同步全部月份（含已送審、已確認，也含生效日之前的月份），不列需重新確認。
// 員編只用 FKF7xxxx、ZT01／ZT02 與保留月份 2099-07～2099-09。

const { m1, m2, m3 } = W06_MONTHS;
const c = {
  stage: w06Code('FKF', 40),
  actPromo: w06Code('FKF', 41),
  actResign: w06Code('FKF', 42),
  actLeave: w06Code('FKF', 43),
  actXfer: w06Code('FKF', 44),
  filler: w06Code('FKF', 45),
  name: w06Code('FKF', 46),
};
const all = () => Object.values(c);
const field = (rows: Record<string, any>[], month: string, key: string, store?: string) => rows.find((r) => r.year_month === month && (!store || r.store_id === store))?.[key];

test.describe('W06 後續問卷 H 組：階段、代理店長自動結束、姓名同步', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  let zt02 = '';
  const started = new Date().toISOString();

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    const ids = await w06StoreIds(admin, m1);
    zt01 = ids.ZT01;
    zt02 = ids.ZT02;
    await purgeW06(all(), [zt01, zt02]);
  });
  test.afterAll(async () => {
    await registerW06(all()).catch(() => undefined);
    await purgeW06(all(), [zt01, zt02]).catch(() => undefined);
    await purgeReceipts(started, [zt01, zt02]).catch(() => undefined);
    await admin?.dispose();
  });

  const stageOf = async (code: string) => (await masterOf(code)).filter((m) => m.is_active)[0] || (await masterOf(code))[0];
  const promote = (code: string, name: string, position: string, date: string, level = '') =>
    submitMovements(admin, [{ employee_code: code, employee_name: name, store_id: zt01, movement_type: 'promotion', position, newbie_level: level, effective_date: date }]);

  test('H.4 升職異動自動更新員工主檔階段：新增、同日取最高、改成其他職位清空', async () => {
    await seedMaster(c.stage, 'W06 階段', zt01, { position: '新人' });
    expect((await stageOf(c.stage)).newbie_level).toBeNull();
    const a = await promote(c.stage, 'W06 階段', '新人', '2025-03-01', '一階新人');
    expect(a.ok, JSON.stringify(a.body)).toBe(true);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '新人', newbie_level: '一階新人' });
    const b = await promote(c.stage, 'W06 階段', '新人', '2025-04-01', '二階新人');
    expect(b.ok, JSON.stringify(b.body)).toBe(true);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '新人', newbie_level: '二階新人' });
    // 補登較早的升職（B.1）只寫歷史，主檔階段仍取最新
    const early = await promote(c.stage, 'W06 階段', '新人', '2025-02-01', '未過階新人');
    expect(early.ok, JSON.stringify(early.body)).toBe(true);
    expect((await stageOf(c.stage)).newbie_level).toBe('二階新人');
    // 升到專員：階段清空
    const p = await promote(c.stage, 'W06 階段', '專員', '2025-05-01');
    expect(p.ok, JSON.stringify(p.body)).toBe(true);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '專員', newbie_level: null });
  });

  test('H.4 員工管理列表與編輯 API 回傳階段；改成其他職位時階段清空', async () => {
    // 先回到新人二階：刪掉最新的專員升職（C.1 刪除後恢復）
    const hist = await historyOf(c.stage);
    const latest = hist[hist.length - 1];
    expect([latest.new_value, latest.movement_date]).toEqual(['專員', '2025-05-01']);
    const del = await admin.delete(`/api/workspace/employee-movements/${latest.id}`);
    expect(del.status(), await del.text()).toBe(200);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '新人', newbie_level: '二階新人' });
    const list = await (await admin.get('/api/workspace/employees')).json();
    const row = list.employees.find((e: any) => e.employee_code === c.stage);
    expect(row).toMatchObject({ current_position: '新人', newbie_level: '二階新人' });
    const editState = await (await admin.get('/api/workspace/employees/edit', { params: { employee: c.stage } })).json();
    expect(editState.employee.newbie_level).toBe('二階新人');
    // 員工管理改成專員：階段清空（階段只屬於新人／行政）
    const put = await admin.put('/api/workspace/employees/edit', {
      data: { requestId: randomUUID(), expected: editState.expected, data: { employee_code: c.stage, employee_name: 'W06 階段', current_position: '專員', start_date: '', birthday: '' } },
    });
    expect(put.status(), await put.text()).toBe(200);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '專員', newbie_level: null });
    const after = await (await admin.get('/api/workspace/employees')).json();
    expect(after.employees.find((e: any) => e.employee_code === c.stage).newbie_level).toBeNull();
  });

  test('H.4 修改升職異動的職位與階段、刪除後恢復：主檔階段同步；刪光升職退回原職位並清空階段', async () => {
    // 目前歷史：2025-02-01 未過階新人、03-01 一階新人、04-01 二階新人（專員升職已刪），主檔因員工管理改為專員。
    const p = await promote(c.stage, 'W06 階段', '專員', '2025-06-01');
    expect(p.ok, JSON.stringify(p.body)).toBe(true);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '專員', newbie_level: null });
    const hist = await historyOf(c.stage);
    const latest = hist[hist.length - 1];
    // 修改：專員 → 新人一階新人
    const patch = await admin.patch(`/api/workspace/employee-movements/${latest.id}`, { data: { position: '新人', newbie_level: '一階新人' } });
    expect(patch.status(), await patch.text()).toBe(200);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '新人', newbie_level: '一階新人' });
    // 刪除後恢復：回到 04-01 的二階新人
    const del = await admin.delete(`/api/workspace/employee-movements/${latest.id}`);
    expect(del.status(), await del.text()).toBe(200);
    expect(await stageOf(c.stage)).toMatchObject({ current_position: '新人', newbie_level: '二階新人' });
    // 逐筆刪光：每刪一筆主檔階段跟著前一筆
    for (const expected of ['一階新人', '未過階新人']) {
      const h = await historyOf(c.stage);
      const last = h[h.length - 1];
      const r = await admin.delete(`/api/workspace/employee-movements/${last.id}`);
      expect(r.status(), await r.text()).toBe(200);
      expect((await stageOf(c.stage)).newbie_level, expected).toBe(expected);
    }
    // 最後一筆：沒有任何升職，主檔退回被刪升職的原職位，階段清空（不猜測）
    const h = await historyOf(c.stage);
    expect(h).toHaveLength(1);
    const r = await admin.delete(`/api/workspace/employee-movements/${h[0].id}`);
    expect(r.status(), await r.text()).toBe(200);
    expect((await stageOf(c.stage)).newbie_level).toBeNull();
  });

  test('H.4 調店確認：員工主檔階段帶到新店主檔', async () => {
    const r = await promote(c.stage, 'W06 階段', '新人', '2025-07-01', '二階新人');
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const created = await admin.post('/api/workspace/transfers/create', { data: { requestId: randomUUID(), data: { employee_code: c.stage, employee_name: 'W06 階段', from_store_id: zt01, to_store_id: zt02, notes: '' } } });
    expect(created.status(), await created.text()).toBe(200);
    const id = (await created.json()).id as string;
    const pv = await admin.post('/api/workspace/transfers/preview', { data: { id, effective_date: '2099-08-20' } });
    expect(pv.status(), await pv.text()).toBe(200);
    const cf = await admin.post('/api/workspace/transfers/confirm', { data: { id, effective_date: '2099-08-20', version: (await pv.json()).version } });
    expect(cf.status(), await cf.text()).toBe(200);
    const active = (await masterOf(c.stage)).filter((m) => m.is_active);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ store_id: zt02, current_position: '新人', newbie_level: '二階新人' });
  });

  test('H.5 升職為店長：該月起名冊不再標代理；之後再登記的代理又會標；刪除店長升職後恢復', async () => {
    await seedMaster(c.actPromo, 'W06 代理升店長', zt01, { position: '主任' });
    await seedRoster(zt01, m1, [{ code: c.actPromo, name: 'W06 代理升店長', position: '主任' }]);
    await seedRoster(zt01, m2, [{ code: c.actPromo, name: 'W06 代理升店長', position: '主任' }]);
    await seedRoster(zt01, m3, [{ code: c.actPromo, name: 'W06 代理升店長', position: '主任' }]);
    await insertHistory({ code: c.actPromo, name: 'W06 代理升店長', store: zt01, type: 'acting_manager', date: '2099-07-05', old: '主任', new: '代理店長' });
    await recompute(c.actPromo, m1);
    let rows = await rosterRows(c.actPromo);
    expect([m1, m2, m3].map((m) => field(rows, m, 'is_acting_manager'))).toEqual([true, true, true]);
    const promoId = await insertHistory({ code: c.actPromo, name: 'W06 代理升店長', store: zt01, type: 'promotion', date: '2099-08-10', old: '主任', new: '店長' });
    await recompute(c.actPromo, m1);
    rows = await rosterRows(c.actPromo);
    expect([m1, m2, m3].map((m) => field(rows, m, 'is_acting_manager'))).toEqual([true, false, false]); // 結束日＝升職日，該月（2099-08）起不標
    expect([m1, m2, m3].map((m) => field(rows, m, 'position'))).toEqual(['主任', '店長', '店長']);
    // 之後再登記代理（9/5）：9 月又標代理
    await insertHistory({ code: c.actPromo, name: 'W06 代理升店長', store: zt01, type: 'acting_manager', date: '2099-09-05', old: '店長', new: '代理店長' });
    await recompute(c.actPromo, m1);
    rows = await rosterRows(c.actPromo);
    expect([m1, m2, m3].map((m) => field(rows, m, 'is_acting_manager'))).toEqual([true, false, true]);
    // 仍可手動取消：把 7 月的勾選取消，其他月份不受影響
    await adminDb().from('monthly_staff_status').update({ is_acting_manager: false }).eq('employee_code', c.actPromo).eq('year_month', m1);
    expect(field(await rosterRows(c.actPromo), m1, 'is_acting_manager')).toBe(false);
    // 刪除（9/5 的代理 → 店長升職）：恢復「到 7、8 月都標代理」的狀態
    const del1 = await historyOf(c.actPromo);
    const lastActing = del1[del1.length - 1];
    expect(lastActing.movement_date).toBe('2099-09-05');
    expect((await admin.delete(`/api/workspace/employee-movements/${lastActing.id}`)).status()).toBe(200);
    const del2 = await admin.delete(`/api/workspace/employee-movements/${promoId}`);
    expect(del2.status(), await del2.text()).toBe(200);
    rows = await rosterRows(c.actPromo);
    expect([m2, m3].map((m) => field(rows, m, 'is_acting_manager'))).toEqual([true, true]);
  });

  test('H.5 離職、留職停薪：結束代理註記，離職／留停當月起不標；留停期間後續月份不列名冊', async () => {
    await seedMaster(c.actResign, 'W06 代理離職', zt01);
    await seedMaster(c.actLeave, 'W06 代理留停', zt01);
    for (const [code, name] of [[c.actResign, 'W06 代理離職'], [c.actLeave, 'W06 代理留停']]) {
      for (const m of [m1, m2, m3]) await seedRoster(zt01, m, [{ code, name }]);
      await insertHistory({ code, name, store: zt01, type: 'acting_manager', date: '2099-07-05', old: '專員', new: '代理店長' });
    }
    await insertHistory({ code: c.actResign, name: 'W06 代理離職', store: zt01, type: 'resignation', date: '2099-08-20', old: 'active', new: 'resigned' });
    await insertHistory({ code: c.actLeave, name: 'W06 代理留停', store: zt01, type: 'leave_without_pay', date: '2099-08-10', old: 'active', new: 'leave_without_pay' });
    await recompute(c.actResign, m1);
    await recompute(c.actLeave, m1);
    const r = await rosterRows(c.actResign);
    expect([m1, m2].map((m) => field(r, m, 'is_acting_manager'))).toEqual([true, false]);
    expect(field(r, m2, 'monthly_status')).toBe('resigned');
    const l = await rosterRows(c.actLeave);
    expect([m1, m2].map((m) => field(l, m, 'is_acting_manager'))).toEqual([true, false]);
    expect(field(l, m2, 'monthly_status')).toBe('leave_of_absence');
    expect(l.some((x) => x.year_month === m3)).toBe(false); // A.4：留停期間後續月份不列名冊
  });

  test('H.5 調店：原店該月起不標代理；同日較晚登記的新店代理只標新店', async () => {
    await seedMaster(c.actXfer, 'W06 代理調店', zt01);
    await seedMaster(c.filler, 'W06 新店其他人', zt02);
    for (const m of [m1, m2, m3]) await seedRoster(zt01, m, [{ code: c.actXfer, name: 'W06 代理調店' }]);
    await seedRoster(zt02, m2, [{ code: c.filler, name: 'W06 新店其他人' }]); // 讓新店 8 月視為已初始化
    await insertHistory({ code: c.actXfer, name: 'W06 代理調店', store: zt01, type: 'acting_manager', date: '2099-07-05', old: '專員', new: '代理店長' });
    await insertHistory({ code: c.actXfer, name: 'W06 代理調店', store: zt02, type: 'store_transfer', date: '2099-08-10', old: await storeName(zt01), new: await storeName(zt02) });
    await recompute(c.actXfer, m1);
    let rows = await rosterRows(c.actXfer);
    expect(field(rows, m1, 'is_acting_manager', zt01)).toBe(true);
    expect(field(rows, m2, 'is_acting_manager', zt01)).toBe(false); // 調出當月起不標
    expect(field(rows, m2, 'is_acting_manager', zt02)).toBe(false); // 調店不自動續任
    // 同日在新店登記代理（較晚登記）：新店標、原店不標
    await insertHistory({ code: c.actXfer, name: 'W06 代理調店', store: zt02, type: 'acting_manager', date: '2099-08-10', old: '專員', new: '代理店長' });
    await recompute(c.actXfer, m1);
    rows = await rosterRows(c.actXfer);
    expect(field(rows, m2, 'is_acting_manager', zt02)).toBe(true);
    expect(field(rows, m2, 'is_acting_manager', zt01)).toBe(false);
    expect(field(rows, m1, 'is_acting_manager', zt01)).toBe(true);
  });

  test('H.9 修改異動姓名：全部月份同步（含已送審、已確認與生效日之前的月份），不列需重新確認', async () => {
    await seedMaster(c.name, 'W06 舊名', zt01, { position: '專員' });
    await seedRoster(zt01, m1, [{ code: c.name, name: 'W06 舊名', status: 'draft' }]);
    await seedRoster(zt01, m2, [{ code: c.name, name: 'W06 舊名', status: 'submitted' }]);
    await seedRoster(zt01, m3, [{ code: c.name, name: 'W06 舊名', status: 'confirmed' }]);
    const id = await insertHistory({ code: c.name, name: 'W06 舊名', store: zt01, type: 'promotion', date: '2099-09-10', old: '專員', new: '組長' });
    const patch = await admin.patch(`/api/workspace/employee-movements/${id}`, { data: { employee_name: 'W06 新名' } });
    expect(patch.status(), await patch.text()).toBe(200);
    const rows = await rosterRows(c.name);
    expect(rows.map((r) => [r.year_month, r.status, r.employee_name])).toEqual([[m1, 'draft', 'W06 新名'], [m2, 'submitted', 'W06 新名'], [m3, 'confirmed', 'W06 新名']]);
    expect((await masterOf(c.name)).every((m) => m.employee_name === 'W06 新名')).toBe(true);
    // 沒有針對姓名的需重新確認或調整紀錄
    expect((await recheckOf(c.name)).filter((x) => x.field === 'employee_name')).toEqual([]);
    expect((await adjustmentsOf(c.name)).filter((x) => x.field === 'employee_name')).toEqual([]);
    // 其他欄位（升職的職位）仍依 A.2：已確認的 9 月不動，只記需重新確認（姓名不在其中）
    expect(rows.map((r) => r.position)).toEqual(['專員', '專員', '專員']);
    expect((await recheckOf(c.name)).some((x) => x.field === 'position' && x.year_month === m3)).toBe(true);
  });
});
