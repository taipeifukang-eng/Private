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

// W06 整合層（M2 規格 C 組）：修改與刪除歷史異動。
//   C.1 只能刪該員工最新一筆；刪除後恢復主檔狀態、門市、職位與受影響月份名冊（A.1、A.2 範圍）；修改範圍照舊版（姓名、日期、備註、
//       升職職位與階段、入職藥師身分），不開放改類型與門市，修改後同樣連動。
//   C.2 修改＝異動管理／員工管理／批次升遷任一；刪除＝刪除異動權限；伺服器端檢查（用 role-matrix 角色驗證拒絕，管理員驗證允許）。
// 員編只用 FKF7xxxx（序號 20～29）、ZT01／ZT02 與保留月份 2099-07～2099-09。

const { m1, m2, m3 } = W06_MONTHS;
const c = {
  perm: w06Code('FKF', 20),
  edit: w06Code('FKF', 21),
  chain: w06Code('FKF', 22),
  lock: w06Code('FKF', 23),
  resign: w06Code('FKF', 24),
  xfer: w06Code('FKF', 25),
  onb: w06Code('FKF', 26),
  list: w06Code('FKF', 27),
  dup: w06Code('FKF', 28),
  other: w06Code('FKF', 29),
};
const all = () => Object.values(c);
const field = (rows: Record<string, any>[], month: string, key: string) => rows.find((r) => r.year_month === month)?.[key];

test.describe('W06 C 組：修改與刪除歷史異動', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  let zt02 = '';
  const started = new Date().toISOString();
  const patch = (id: string, data: Record<string, unknown>, who: APIRequestContext = admin) => who.patch(`/api/workspace/employee-movements/${id}`, { data });
  const del = (id: string, who: APIRequestContext = admin) => who.delete(`/api/workspace/employee-movements/${id}`);

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
  test.afterAll(async () => {
    await clean().catch(() => undefined);
    await purgeReceipts(started, [zt01, zt02]).catch(() => undefined);
    await admin?.dispose();
  });

  test('C.2 權限：沒有權限的 role-matrix 角色修改與刪除都被伺服器擋下（403），資料不變；管理員可操作', async () => {
    await seedMaster(c.perm, 'W06 權限', zt01);
    const id = await insertHistory({ code: c.perm, name: 'W06 權限', store: zt01, type: 'leave_without_pay', date: '2099-07-20' });
    const denied = ['denied', 'employee', 'employee_view', 'employee_edit', 'employee_delete', 'store_manager', 'supervisor', 'monthly_edit', 'ops_manager'];
    for (const role of denied) {
      const who = await apiAs(role);
      try {
        const p = await patch(id, { employee_name: '不該改' }, who);
        expect(p.status(), `${role} PATCH`).toBe(403);
        const d = await del(id, who);
        expect(d.status(), `${role} DELETE`).toBe(403);
        const g = await who.get('/api/workspace/employee-movements', { params: { month: m1 } });
        expect(g.status(), `${role} GET 歷史頁`).toBe(403);
      } finally {
        await who.dispose();
      }
    }
    expect((await historyOf(c.perm)).map((h) => h.employee_name)).toEqual(['W06 權限']);
    // 管理員（擁有全部權限）：歷史頁回傳 canEdit／canDelete，修改成功
    const list = await admin.get('/api/workspace/employee-movements', { params: { month: m1 } });
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.canEdit).toBe(true);
    expect(body.canDelete).toBe(true);
    const ok = await patch(id, { notes: '管理員修改' });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await historyOf(c.perm))[0].notes).toBe('管理員修改');
  });

  test('C.1 修改：姓名、日期、備註同步主檔與名冊；不開放改類型與門市；欄位驗證', async () => {
    await seedMaster(c.edit, 'W06 修改前', zt01);
    await seedRoster(zt01, m1, [{ code: c.edit, name: 'W06 修改前' }]);
    await seedRoster(zt01, m2, [{ code: c.edit, name: 'W06 修改前', status: 'submitted' }]);
    const id = await insertHistory({ code: c.edit, name: 'W06 修改前', store: zt01, type: 'pass_probation', date: '2099-07-05', old: '專員', new: '專員' });
    const res = await patch(id, { employee_name: 'W06 修改後', movement_date: '2099-07-08', notes: '改備註', movement_type: 'resignation', store_id: zt02 });
    expect(res.status(), await res.text()).toBe(200);
    const h = (await historyOf(c.edit))[0];
    expect([h.employee_name, h.movement_date, h.notes, h.movement_type, h.store_id]).toEqual(['W06 修改後', '2099-07-08', '改備註', 'pass_probation', zt01]);
    expect((await masterOf(c.edit))[0].employee_name).toBe('W06 修改後');
    const rows = await rosterRows(c.edit);
    expect(field(rows, m1, 'employee_name')).toBe('W06 修改後'); // 草稿月份同步
    expect(field(rows, m2, 'employee_name')).toBe('W06 修改前'); // 已送審月份不動（A.2）
    // 驗證
    for (const bad of [{ movement_date: '2099-13-40' }, { movement_date: '115-01-01' }, { employee_name: '' }, { notes: 'x'.repeat(5001) }]) {
      const r = await patch(id, bad);
      expect(r.status(), JSON.stringify(bad)).toBe(400);
    }
    expect((await patch('00000000-0000-4000-8000-000000000000', { notes: 'x' })).status()).toBe(404);
    expect((await patch('not-a-uuid', { notes: 'x' })).status()).toBe(404);
    expect((await del('00000000-0000-4000-8000-000000000000')).status()).toBe(404);
  });

  test('C.1 修改升職：職位與階段同步名冊與主檔；同員工同日同職位重複回 409；已送審月份只記需重新確認（A.2）', async () => {
    await seedMaster(c.dup, 'W06 升職修改', zt01, { position: '專員' });
    await seedRoster(zt01, m1, [{ code: c.dup, name: 'W06 升職修改' }]);
    await seedRoster(zt01, m2, [{ code: c.dup, name: 'W06 升職修改', status: 'submitted' }]);
    const p1 = await insertHistory({ code: c.dup, name: 'W06 升職修改', store: zt01, type: 'promotion', date: '2025-03-10', old: '專員', new: '組長' });
    const p2 = await insertHistory({ code: c.dup, name: 'W06 升職修改', store: zt01, type: 'promotion', date: '2025-03-11', old: '組長', new: '主任' });
    await recompute(c.dup, m1, { type: 'promotion' });
    expect(field(await rosterRows(c.dup), m1, 'position')).toBe('主任');
    // 把第二筆改成「組長」→ 與第一筆同職位但不同日不衝突；改同日同職位則 409
    expect((await patch(p2, { position: '副店長' })).status()).toBe(200);
    const rows = await rosterRows(c.dup);
    expect(field(rows, m1, 'position')).toBe('副店長'); // 草稿月份以異動為準
    expect(field(rows, m2, 'position')).toBe('專員'); // 已送審月份不動
    expect((await recheckOf(c.dup)).some((x) => x.year_month === m2 && x.field === 'position')).toBe(true);
    expect((await adjustmentsOf(c.dup)).some((x) => x.year_month === m1 && x.field === 'position' && x.new_value === '副店長')).toBe(true);
    expect((await masterOf(c.dup))[0].current_position).toBe('副店長'); // B.3 主檔同步
    const dup = await patch(p2, { movement_date: '2025-03-10', position: '組長' });
    expect(dup.status()).toBe(409);
    // 行政需要階級；新人需要階段
    expect((await patch(p2, { position: '行政' })).status()).toBe(400);
    expect((await patch(p2, { position: '行政', newbie_level: '過階行政' })).status()).toBe(200);
    const h = (await historyOf(c.dup)).find((x) => x.id === p2)!;
    expect([h.new_value, h.notes]).toEqual(['行政', '行政階級:過階行政']);
    expect(field(await rosterRows(c.dup), m1, 'newbie_level')).toBe('過階行政');
    expect(p1).toBeTruthy();
  });

  test('C.1 修改入職：藥師身分與到職日同步主檔與名冊', async () => {
    await seedMaster(c.onb, 'W06 入職修改', zt01, { position: '新人', startDate: '2099-07-10' });
    await seedRoster(zt01, m1, [{ code: c.onb, name: 'W06 入職修改', position: '新人' }]);
    const id = await insertHistory({ code: c.onb, name: 'W06 入職修改', store: zt01, type: 'onboarding', date: '2099-07-10', old: null, new: 'active', notes: '是否藥師:否', pharmacist: false });
    await recompute(c.onb, m1);
    const r = await patch(id, { onboarding_is_pharmacist: true, movement_date: '2099-07-12', notes: '到職日更正' });
    expect(r.status(), await r.text()).toBe(200);
    const h = (await historyOf(c.onb))[0];
    expect([h.onboarding_is_pharmacist, h.movement_date, h.notes]).toEqual([true, '2099-07-12', '到職日更正；是否藥師:是']);
    const m = (await masterOf(c.onb))[0];
    expect([m.is_pharmacist, m.start_date]).toEqual([true, '2099-07-12']);
    const row = (await rosterRows(c.onb))[0];
    expect(row.is_pharmacist).toBe(true);
    expect(Number(row.work_days)).toBe(20); // 31 - 12 + 1
  });

  test('C.1 刪除升職：只能刪最新一筆；刪除後主檔職位與名冊逐步恢復，已送審月份不動', async () => {
    await seedMaster(c.chain, 'W06 刪升職', zt01, { position: '專員' });
    await seedRoster(zt01, m1, [{ code: c.chain, name: 'W06 刪升職' }]);
    await seedRoster(zt01, m2, [{ code: c.chain, name: 'W06 刪升職', status: 'submitted' }]);
    const p1 = await insertHistory({ code: c.chain, name: 'W06 刪升職', store: zt01, type: 'promotion', date: '2025-03-10', old: '專員', new: '組長' });
    const p2 = await insertHistory({ code: c.chain, name: 'W06 刪升職', store: zt01, type: 'promotion', date: '2025-05-10', old: '組長', new: '副店長' });
    await recompute(c.chain, m1, { type: 'promotion' });
    await adminDb().from('store_employees').update({ position: '副店長', current_position: '副店長' }).eq('employee_code', c.chain);
    expect(field(await rosterRows(c.chain), m1, 'position')).toBe('副店長');

    // 非最新一筆：409，提示先刪較新的一筆，資料不變
    const blocked = await del(p1);
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error).toContain('較新');
    expect(await historyOf(c.chain)).toHaveLength(2);
    // 歷史頁標示哪一筆可刪（is_latest）
    const hist = await historyOf(c.chain);
    expect(hist.map((x) => x.id)).toEqual([p1, p2]);

    // 刪最新一筆（副店長）：主檔職位、草稿月份名冊恢復為組長；已送審月份不動
    const d2 = await del(p2);
    expect(d2.status(), await d2.text()).toBe(200);
    expect((await d2.json()).movement_type).toBe('promotion');
    expect((await historyOf(c.chain)).map((x) => x.id)).toEqual([p1]);
    expect((await masterOf(c.chain))[0].current_position).toBe('組長');
    let rows = await rosterRows(c.chain);
    expect(field(rows, m1, 'position')).toBe('組長');
    expect(field(rows, m2, 'position')).toBe('專員');
    expect(field(rows, m2, 'status')).toBe('submitted');
    expect((await recheckOf(c.chain)).some((x) => x.year_month === m2 && x.field === 'position')).toBe(true); // 已送審月份記入需重新確認（A.2）

    // 再刪最後一筆升職：主檔退回原職位，名冊也回到專員
    const d1 = await del(p1);
    expect(d1.status(), await d1.text()).toBe(200);
    expect(await historyOf(c.chain)).toHaveLength(0);
    expect((await masterOf(c.chain))[0].current_position).toBe('專員');
    rows = await rosterRows(c.chain);
    expect(field(rows, m1, 'position')).toBe('專員');
    expect(field(rows, m2, 'position')).toBe('專員');
    expect(await recheckOf(c.chain)).toHaveLength(0); // 已送審月份與重算結果一致，清單自動結案
    expect((await del(p1)).status()).toBe(404); // 已刪除
  });

  test('C.1 刪除離職：員工主檔恢復在職，被移出的後續月份名冊恢復；已送審月份不被改動', async () => {
    await seedMaster(c.resign, 'W06 刪離職', zt01);
    for (const m of [m1, m2, m3]) await seedRoster(zt01, m, [{ code: c.resign, name: 'W06 刪離職' }, { code: c.other, name: 'W06 其他人' }].filter((x, i) => i === 0 || m !== m1));
    await insertHistory({ code: c.resign, name: 'W06 刪離職', store: zt01, type: 'onboarding', date: '2090-01-01', old: null, new: 'active', pharmacist: false });
    const sub = await submitMovements(admin, [{ employee_code: c.resign, employee_name: 'W06 刪離職', store_id: zt01, movement_type: 'resignation', effective_date: '2099-08-12' }]);
    expect(sub.ok, JSON.stringify(sub.body)).toBe(true);
    expect((await rosterRows(c.resign)).map((x) => x.year_month)).toEqual([m1, m2]); // 9 月已移出
    expect((await masterOf(c.resign))[0].employment_status).toBe('resigned');
    const last = (await historyOf(c.resign)).at(-1)!;
    expect(last.movement_type).toBe('resignation');

    const d = await del(String(last.id));
    expect(d.status(), await d.text()).toBe(200);
    const master = (await masterOf(c.resign))[0];
    expect([master.employment_status, master.is_active, master.last_movement_type]).toEqual(['active', true, 'onboarding']);
    const rows = await rosterRows(c.resign);
    expect(rows.map((x) => x.year_month)).toEqual([m1, m2, m3]); // 後續月份恢復
    expect(field(rows, m2, 'monthly_status')).not.toBe('resigned');
  });

  test('C.1 刪除調店：原店主檔恢復在職、新店主檔停用', async () => {
    const fromName = await storeName(zt01);
    const toName = await storeName(zt02);
    await insertHistory({ code: c.xfer, name: 'W06 刪調店', store: zt01, type: 'onboarding', date: '2090-01-01', old: null, new: 'active', pharmacist: false });
    await seedMaster(c.xfer, 'W06 刪調店', zt01, { active: false, status: 'resigned' });
    await seedMaster(c.xfer, 'W06 刪調店', zt02, { active: true });
    await adminDb().from('store_employees').update({ last_movement_date: '2099-08-15', last_movement_type: 'store_transfer' }).eq('employee_code', c.xfer);
    const id = await insertHistory({ code: c.xfer, name: 'W06 刪調店', store: zt02, type: 'store_transfer', date: '2099-08-15', old: fromName, new: toName });
    const d = await del(id);
    expect(d.status(), await d.text()).toBe(200);
    const masters = await masterOf(c.xfer);
    expect(masters.filter((x) => x.is_active).map((x) => x.store_id)).toEqual([zt01]);
    expect(masters.find((x) => x.store_id === zt02)!.employment_status).toBe('resigned');
    expect(masters.find((x) => x.store_id === zt01)!.employment_status).toBe('active');
  });

  test('C.1 歷史頁列表：is_latest 標示每位員工最新一筆，並回傳權限旗標與職位選項', async () => {
    await seedMaster(c.list, 'W06 列表', zt01);
    const a = await insertHistory({ code: c.list, name: 'W06 列表', store: zt01, type: 'pass_probation', date: '2099-07-03', old: '專員', new: '專員' });
    const b = await insertHistory({ code: c.list, name: 'W06 列表', store: zt01, type: 'leave_without_pay', date: '2099-07-20' });
    const res = await admin.get('/api/workspace/employee-movements', { params: { month: m1, size: '100' } });
    const body = await res.json();
    const mine = (body.rows as any[]).filter((r) => r.employee_code === c.list);
    expect(mine.map((r) => [r.id, r.is_latest])).toEqual([[a, false], [b, true]]);
    expect(body.positions).toContain('店長');
    expect(body.newbieLevels.length).toBeGreaterThan(0);
    expect(body.adminLevels.length).toBeGreaterThan(0);
  });
});
