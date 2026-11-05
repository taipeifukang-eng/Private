import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import {
  W06_MONTHS,
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

// W06 審查修正的回歸案例（M2 規格 A.1／A.2／A.4／B.3／C.1）：
//   1 刪調店、刪重新入職、改入職日期、刪唯一入職後，名冊只剩正確的門市與月份（不再重複計算人數）
//   2 兼職（FKPT）與一般 FK 員工：後續月份新建的名冊列職位與階段跟入職一致
//   3 同日留停與復職被擋下  4 刪除未生效升職不改主檔  5 刪除已確認調店標記申請已撤銷
// 員編只用 FKF7xxxx（序號 30～39）、FK7xxx、FKPT8xx、ZT01／ZT02 與保留月份 2099-07～2099-09。

const { m1, m2, m3 } = W06_MONTHS;
const c = {
  xfer: w06Code('FKF', 30),
  rehire: w06Code('FKF', 31),
  edate: w06Code('FKF', 32),
  only: w06Code('FKF', 33),
  same: w06Code('FKF', 34),
  future: w06Code('FKF', 35),
  req: w06Code('FKF', 36),
  other: w06Code('FKF', 37),
  other2: w06Code('FKF', 38),
  fk: w06Code('FK', 0),
  pt: w06Code('FKPT', 5),
};
const all = () => Object.values(c);
const field = (rows: Record<string, any>[], month: string, key: string, store?: string) =>
  rows.find((r) => r.year_month === month && (!store || r.store_id === store))?.[key];
const months = (rows: Record<string, any>[], store: string) => rows.filter((r) => r.store_id === store).map((r) => r.year_month);

test.describe('W06 審查修正回歸', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  let zt02 = '';
  const started = new Date().toISOString();
  const del = (id: string) => admin.delete(`/api/workspace/employee-movements/${id}`);
  const patch = (id: string, data: Record<string, unknown>) => admin.patch(`/api/workspace/employee-movements/${id}`, { data });

  const clean = async () => {
    await registerW06(all()).catch(() => undefined);
    await purgeW06(all(), [zt01, zt02]);
  };
  test.beforeAll(async () => {
    admin = await apiAs('admin');
    const ids = await w06StoreIds(admin, m1);
    zt01 = ids.ZT01;
    zt02 = ids.ZT02;
    await purgeW06(all(), [zt01, zt02]);
  });
  test.afterEach(async () => {
    await clean().catch(() => undefined);
  });
  test.afterAll(async () => {
    await clean().catch(() => undefined);
    await purgeReceipts(started, [zt01, zt02]).catch(() => undefined);
    await admin?.dispose();
  });

  const initStores = async () => {
    for (const m of [m1, m2, m3]) {
      await seedRoster(zt01, m, [{ code: c.other, name: 'W06 ZT01 其他人' }]);
      await seedRoster(zt02, m, [{ code: c.other2, name: 'W06 ZT02 其他人' }]);
    }
  };

  test('刪除調店：調入店的調入月與後續整月列一併移出，員工只剩在原店名冊', async () => {
    const a = c.xfer;
    await initStores();
    await seedMaster(a, 'W06 刪調店列', zt01);
    await insertHistory({ code: a, name: 'W06 刪調店列', store: zt01, type: 'onboarding', date: '2099-07-01', old: null, new: 'active', pharmacist: false });
    const fromName = await storeName(zt01);
    const toName = await storeName(zt02);
    const id = await insertHistory({ code: a, name: 'W06 刪調店列', store: zt02, type: 'store_transfer', date: '2099-08-10', old: fromName, new: toName });
    await recompute(a, m1);
    let rows = await rosterRows(a);
    expect(months(rows, zt02)).toEqual([m2, m3]); // 調入後兩家店有列
    expect(field(rows, m2, 'monthly_status', zt01)).toBe('transferred_out');
    const res = await del(id);
    expect(res.status(), await res.text()).toBe(200);
    rows = await rosterRows(a);
    expect(months(rows, zt02)).toEqual([]); // ZT02 調入列與整月列都移出
    expect(months(rows, zt01)).toEqual([m1, m2, m3]);
    expect(field(rows, m2, 'monthly_status', zt01)).not.toBe('transferred_out');
    expect((await rosterRows(a)).filter((r) => r.year_month === m3)).toHaveLength(1); // 人數不重複
  });

  test('刪除重新入職：後面門市的到職列移出，員工維持離職', async () => {
    const a = c.rehire;
    await initStores();
    await seedMaster(a, 'W06 刪重新入職', zt01);
    await insertHistory({ code: a, name: 'W06 刪重新入職', store: zt01, type: 'onboarding', date: '2099-07-01', old: null, new: 'active', pharmacist: false });
    await insertHistory({ code: a, name: 'W06 刪重新入職', store: zt01, type: 'resignation', date: '2099-08-05' });
    const id = await insertHistory({ code: a, name: 'W06 刪重新入職', store: zt02, type: 'onboarding', date: '2099-09-03', old: null, new: 'active', pharmacist: false });
    await recompute(a, m1);
    expect(months(await rosterRows(a), zt02)).toEqual([m3]);
    const res = await del(id);
    expect(res.status(), await res.text()).toBe(200);
    const rows = await rosterRows(a);
    expect(months(rows, zt02)).toEqual([]);
    expect(months(rows, zt01)).toEqual([m1, m2]); // 離職後不列名冊
  });

  test('修改入職日期（跨月）：原月份的到職列移出，新月份標成新日期到職', async () => {
    const a = c.edate;
    await initStores();
    await seedMaster(a, 'W06 改入職日', zt01, { position: '新人', startDate: '2099-07-10' });
    const id = await insertHistory({ code: a, name: 'W06 改入職日', store: zt01, type: 'onboarding', date: '2099-07-10', old: null, new: 'active', notes: '是否藥師:否', pharmacist: false });
    await recompute(a, m1);
    expect(months(await rosterRows(a), zt01)).toEqual([m1, m2, m3]);
    const res = await patch(id, { movement_date: '2099-08-10' });
    expect(res.status(), await res.text()).toBe(200);
    const rows = await rosterRows(a);
    expect(months(rows, zt01)).toEqual([m2, m3]); // 7 月列移出
    expect(field(rows, m2, 'partial_month_notes')).toBe('08/10到職');
    expect(field(rows, m2, 'monthly_status')).toBe('new_hire');
  });

  test('刪除唯一一筆入職：未鎖定月份名冊列移出、已送審月份記需重新確認，主檔停用', async () => {
    const a = c.only;
    await initStores();
    await seedMaster(a, 'W06 刪唯一入職', zt01, { position: '新人', startDate: '2099-07-10' });
    const id = await insertHistory({ code: a, name: 'W06 刪唯一入職', store: zt01, type: 'onboarding', date: '2099-07-10', old: null, new: 'active', pharmacist: false });
    await adminDb().from('store_employees').update({ last_movement_date: '2099-07-10', last_movement_type: 'onboarding' }).eq('employee_code', a);
    await recompute(a, m1);
    expect(months(await rosterRows(a), zt01)).toEqual([m1, m2, m3]);
    await adminDb().from('monthly_staff_status').update({ status: 'submitted' }).eq('employee_code', a).eq('year_month', m3);
    const res = await del(id);
    expect(res.status(), await res.text()).toBe(200);
    const rows = await rosterRows(a);
    expect(months(rows, zt01)).toEqual([m3]); // 已送審月份不動
    expect((await recheckOf(a)).some((x) => x.year_month === m3 && x.field === 'roster_row')).toBe(true);
    const master = (await masterOf(a))[0];
    expect([master.is_active, master.employment_status]).toEqual([false, 'resigned']);
  });

  test('FKPT 兼職藥師與一般 FK：入職後各月新建列的職位與階段一致（代理店長不影響）', async () => {
    await initStores();
    const pt = await submitMovements(admin, [{ employee_code: c.pt, employee_name: 'W06 兼職藥師', store_id: zt01, movement_type: 'onboarding', birthday: '1995-04-05', effective_date: '2099-07-10', onboarding_is_pharmacist: true }]);
    expect(pt.ok, JSON.stringify(pt.body)).toBe(true);
    const act = await submitMovements(admin, [{ employee_code: c.pt, employee_name: 'W06 兼職藥師', store_id: zt01, movement_type: 'acting_manager', position: '代理店長', effective_date: '2099-08-05' }]);
    expect(act.ok, JSON.stringify(act.body)).toBe(true);
    let rows = await rosterRows(c.pt);
    expect(rows.map((r) => [r.year_month, r.position, r.newbie_level])).toEqual([[m1, '兼職藥師', null], [m2, '兼職藥師', null], [m3, '兼職藥師', null]]);
    expect((await masterOf(c.pt))[0].position).toBe('兼職藥師');

    const fk = await submitMovements(admin, [{ employee_code: c.fk, employee_name: 'W06 一般新人', store_id: zt01, movement_type: 'onboarding', birthday: '1995-04-05', effective_date: '2099-07-10', onboarding_is_pharmacist: false }]);
    expect(fk.ok, JSON.stringify(fk.body)).toBe(true);
    rows = await rosterRows(c.fk);
    expect(rows.map((r) => [r.year_month, r.position, r.newbie_level])).toEqual([[m1, '新人', '未過階新人'], [m2, '新人', '未過階新人'], [m3, '新人', '未過階新人']]);
  });

  test('同一天留停與復職：登記時擋下，歷史只留第一筆', async () => {
    const a = c.same;
    await seedMaster(a, 'W06 同日', zt01);
    await insertHistory({ code: a, name: 'W06 同日', store: zt01, type: 'onboarding', date: '2090-01-01', old: null, new: 'active', pharmacist: false });
    const first = await submitMovements(admin, [{ employee_code: a, employee_name: 'W06 同日', store_id: zt01, movement_type: 'leave_without_pay', effective_date: '2099-08-01' }]);
    expect(first.ok, JSON.stringify(first.body)).toBe(true);
    const second = await submitMovements(admin, [{ employee_code: a, employee_name: 'W06 同日', store_id: zt01, movement_type: 'return_to_work', effective_date: '2099-08-01' }]);
    expect(second.ok).toBe(false);
    expect((await historyOf(a)).filter((h) => h.movement_date === '2099-08-01').map((h) => h.movement_type)).toEqual(['leave_without_pay']);
    // 同一批裡同日留停與復職也不存
    const batch = await submitMovements(admin, [
      { employee_code: c.future, employee_name: 'W06 同批', store_id: zt01, movement_type: 'leave_without_pay', effective_date: '2099-08-01' },
      { employee_code: c.future, employee_name: 'W06 同批', store_id: zt01, movement_type: 'return_to_work', effective_date: '2099-08-01' },
    ]);
    expect(batch.ok).toBe(false);
  });

  test('刪除未生效的升職：只剩未來升職時主檔職位不被改成被刪升職的原職位', async () => {
    const a = c.future;
    await seedMaster(a, 'W06 未來升職', zt01, { position: '新人' });
    await insertHistory({ code: a, name: 'W06 未來升職', store: zt01, type: 'promotion', date: '2099-09-01', old: '新人', new: '專員' });
    const later = await insertHistory({ code: a, name: 'W06 未來升職', store: zt01, type: 'promotion', date: '2099-09-01', old: '專員', new: '新人', notes: '新人等級:二階新人' });
    const res = await del(later);
    expect(res.status(), await res.text()).toBe(200);
    const m = (await masterOf(a))[0];
    expect([m.position, m.current_position, m.last_promotion_date]).toEqual(['新人', '新人', null]);
    expect(await historyOf(a)).toHaveLength(1);
  });

  test('刪除已確認的調店：申請標記為已撤銷並保留紀錄，不再指向已刪除的異動', async () => {
    const a = c.req;
    const fromName = await storeName(zt01);
    const toName = await storeName(zt02);
    await seedMaster(a, 'W06 撤銷申請', zt01, { active: false, status: 'resigned' });
    await seedMaster(a, 'W06 撤銷申請', zt02, { active: true });
    await insertHistory({ code: a, name: 'W06 撤銷申請', store: zt01, type: 'onboarding', date: '2090-01-01', old: null, new: 'active', pharmacist: false });
    const id = await insertHistory({ code: a, name: 'W06 撤銷申請', store: zt02, type: 'store_transfer', date: '2099-08-15', old: fromName, new: toName });
    const { data: ins, error } = await adminDb()
      .from('store_transfer_requests')
      .insert({ employee_code: a, employee_name: 'W06 撤銷申請', from_store_id: zt01, to_store_id: zt02, status: 'confirmed', effective_date: '2099-08-15', movement_history_id: id, notes: '原備註' })
      .select('id')
      .single();
    expect(error).toBeNull();
    const res = await del(id);
    expect(res.status(), await res.text()).toBe(200);
    const { data } = await adminDb().from('store_transfer_requests').select('status,movement_history_id,notes').eq('id', ins!.id).single();
    expect(data?.status).toBe('rejected');
    expect(data?.movement_history_id).toBeNull();
    expect(data?.notes).toContain('原備註');
    expect(data?.notes).toContain('已撤銷');
  });
});
