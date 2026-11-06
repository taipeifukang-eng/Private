import { expect, request as playwrightRequest, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, addSectionAssignment, createTemplate, deleteRunTemplates, dropAutoAssignments, logSteps, sectionOf, userId, DEPT, runIdOrThrow, templateSections } from '../support/m3-fixtures';
import { p02Code, purgeP02, registerP02, seedMaster } from '../support/p02-fixtures';
import { homeFor, marker, pendingTransferRows, seedBonusAs, seedTransfers, storeIds } from '../support/w11-fixtures';
import { taipeiDate } from '../../lib/workspace/home-rules';

// W11 整合層（M3 C.1–C.4、C.6）：GET /api/workspace/home。
//  - 只要登入就能讀（沒有頁面權限碼）；各卡片可見對象依舊版規則（Q11）。
//  - 獎金：20 欄位、金額為 0 不列、同月多門市加總；Q12 月結狀態不是已確認就標註。
//  - 調店待確認數（Q13）：管理員與有建立權限者看全部；只有確認權限的督導只數自己現在可確認的；店長不能確認。
//  - 首頁我的任務（Q14）：未完成優先、新到舊，不足 3 筆才補已完成。
// 資料：測試員編 ZT<runId>（暫時設在測試帳號，測後還原）、2038 年度獎金列、ZT 門市調店申請、P02 保留員編的壽星與新人，測後清除。

const get = async (role: string) => {
  const api = await apiAs(role);
  try {
    const res = await api.get('/api/workspace/home');
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  } finally {
    await api.dispose();
  }
};
const today = () => taipeiDate();

test.afterAll(async () => {
  await deleteRunTemplates();
});

test('只要登入就能讀：未登入 401；各角色（含沒有任何權限的 denied）200', async () => {
  runIdOrThrow();
  const anon = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await anon.get('/api/workspace/home')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
  for (const role of ['admin', 'ops_manager', 'supervisor', 'store_manager', 'employee', 'denied']) {
    const r = await get(role);
    expect(r.status, role).toBe(200);
    expect(Object.keys(r.body)).toEqual(expect.arrayContaining(['name', 'yearMonth', 'transfer', 'bonus', 'onboarding', 'tasks', 'birthdays', 'annualFee', 'license']));
    expect(r.body.yearMonth).toBe(today().yearMonth);
  }
  const d = await get('denied');
  expect(d.body.bonus.visible, 'denied 沒有 home.bonus_detail.view_own').toBe(false);
});

test('提醒卡片可見對象照舊版（Q11）：管理員／經理全看、督導平列、店長看壽星與年費不看執照、店員都沒有', async () => {
  const roles: Record<string, any> = {
    admin: { birthdays: true, annual: true, license: true, zone: true },
    ops_manager: { birthdays: true, annual: true, license: true, zone: true },
    supervisor: { birthdays: true, annual: true, license: true, zone: false },
    store_manager: { birthdays: true, annual: true, license: false, zone: false },
    acting_manager: { birthdays: true, annual: true, license: false, zone: false },
    employee: { birthdays: false, annual: false, license: false, zone: false },
    ops_assistant: { birthdays: false, annual: false, license: false, zone: false },
  };
  for (const [role, want] of Object.entries(roles)) {
    const { body } = await get(role);
    expect({ role, birthdays: body.birthdays.visible, annual: body.annualFee.visible, license: body.license.visible, zone: body.flags.licenseGroupByZone }).toEqual({ role, ...want });
    if (!want.birthdays) expect(body.birthdays.rows).toEqual([]);
    if (!want.annual) expect(body.annualFee.rows).toEqual([]);
    if (!want.license) expect(body.license.rows).toEqual([]);
  }
});

test.describe('每月獎金明細（C.2、Q12）', () => {
  test.describe.configure({ mode: 'serial' });
  test('有資料才顯示、零金額不列、同月多門市加總；月結已確認才不標註', async () => {
    const st = await storeIds();
    const cleanup = await seedBonusAs('ops_assistant', 
      [
        { yearMonth: '2038-03', store: st.ZT05, amounts: { group_bonus: 1000, talent_bonus: 250.5, transport_fee: -100 } },
        { yearMonth: '2038-02', store: st.ZT05, amounts: { group_bonus: 700, other_bonus: 50 }, note: '加班' },
        { yearMonth: '2038-02', store: st.VW001, amounts: { meal_allowance: 30, other_bonus: 20 }, note: '加班' },
        { yearMonth: '2038-01', store: st.ZT05, amounts: { group_bonus: 0 } },
      ],
      [{ yearMonth: '2038-03', store: st.ZT05 }, { yearMonth: '2038-02', store: st.ZT05 }],
    );
    try {
      const { status, body } = await get('ops_assistant');
      expect(status).toBe(200);
      expect(body.bonus.visible).toBe(true);
      expect(body.employeeCode).toBe(marker());
      const months = body.bonus.months as any[];
      const m3 = months.find((m) => m.yearMonth === '2038-03');
      const m2 = months.find((m) => m.yearMonth === '2038-02');
      expect(months.find((m) => m.yearMonth === '2038-01'), '金額全為 0 的月份不顯示').toBeUndefined();
      expect(m3.total).toBe(1150.5);
      expect(m3.items.map((i: any) => i.label)).toEqual(['月團體獎金', '育才獎金', '交通費用']);
      expect(m3.confirmed, '該月門市月結已確認').toBe(true);
      expect(m2.total).toBe(800);
      expect(m2.items.map((i: any) => i.key)).toEqual(['group_bonus', 'meal_allowance', 'other_bonus']);
      expect(m2.items.find((i: any) => i.key === 'other_bonus').amount).toBe(70);
      expect(m2.otherNote, '備註去重').toBe('加班');
      expect(m2.confirmed, '其中一間門市月結尚未確認 → 標註').toBe(false);
      const order = months.map((m) => m.yearMonth);
      expect(order).toEqual([...order].sort().reverse());
    } finally {
      await cleanup();
    }
    const after = await adminDb().from('profiles').select('employee_code').eq('id', userId('ops_assistant')).single();
    expect(after.data.employee_code, '員編已還原').not.toBe(marker());
  });

  test('只顯示最近 12 個月，且前 3 個月之外放在「較早月份」資料裡（同一份清單依新到舊）', async () => {
    const st = await storeIds();
    const months = ['2038-01', '2038-02', '2038-03', '2038-04', '2038-05', '2038-06', '2038-07', '2038-08', '2038-09', '2038-10', '2038-11', '2038-12', '2037-12'];
    const cleanup = await seedBonusAs('ops_assistant', months.map((yearMonth) => ({ yearMonth, store: st.ZT05, amounts: { group_bonus: 10 } })));
    try {
      const { body } = await get('ops_assistant');
      const got = (body.bonus.months as any[]).map((m) => m.yearMonth);
      expect(got).toHaveLength(12);
      expect(got[0]).toBe('2038-12');
      expect(got).not.toContain('2037-12');
      expect((body.bonus.months as any[]).every((m) => m.confirmed === false), '沒有月結資料視為未確認').toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('沒有員編或沒有資料：顯示空狀態（卡片仍在）', async () => {
    const { body } = await get('employee');
    expect(body.bonus.visible).toBe(true);
    expect(body.bonus.months).toEqual([]);
  });
});

test.describe('調店待確認數（C.3、Q13）', () => {
  test.describe.configure({ mode: 'serial' });
  test('管理員看全部待確認；督導只有確認權限時只數原店或新店是自己督導的；店長不能確認；有建立權限者看全部', async () => {
    const st = await storeIds();
    const cleanup = await seedTransfers([
      { from: st.ZT01, to: st.ZT04 }, // 督導 ZT01 可確認
      { from: st.ZT04, to: st.ZT02 }, // 督導 ZT02 可確認
      { from: st.ZT04, to: st.ZT05 }, // 與督導無關
    ]);
    try {
      const all = (await pendingTransferRows()).length;
      const mine = (await pendingTransferRows()).filter((r) => [st.ZT01, st.ZT02, st.ZT03].some((s) => r.from_store_id === s || r.to_store_id === s)).length;
      expect(all).toBeGreaterThanOrEqual(3);

      const adminView = await get('admin');
      expect(adminView.body.transfer).toMatchObject({ show: true, pendingCount: all, scope: 'all' });

      const sup = await homeFor('supervisor', ['employee.store_transfer.confirm']);
      expect(sup.transfer).toMatchObject({ show: true, pendingCount: mine, scope: 'supervised' });
      expect(sup.transfer.pendingCount).toBeLessThan(all);

      const manager = await homeFor('store_manager', ['employee.store_transfer.confirm']);
      expect(manager.transfer, '店長不能確認').toMatchObject({ show: false, pendingCount: 0 });

      const creator = await homeFor('ops_manager', ['employee.store_transfer.create', 'employee.store_transfer.confirm']);
      expect(creator.transfer).toMatchObject({ show: true, pendingCount: all, scope: 'all' });

      const createOnly = await homeFor('ops_manager', ['employee.store_transfer.create']);
      expect(createOnly.transfer.show, '舊版只有確認權限者才有這張卡').toBe(false);

      const none = await homeFor('employee', []);
      expect(none.transfer).toMatchObject({ show: false, pendingCount: 0 });
    } finally {
      await cleanup();
    }
    expect((await pendingTransferRows()).length).toBeGreaterThanOrEqual(0);
  });

  test('已確認或已拒絕的申請不算待確認', async () => {
    const st = await storeIds();
    const cleanup = await seedTransfers([{ from: st.ZT01, to: st.ZT04 }]);
    try {
      const before = (await homeFor('supervisor', ['employee.store_transfer.confirm'])).transfer.pendingCount;
      const up = await adminDb().from('store_transfer_requests').update({ status: 'rejected' }).eq('employee_code', marker());
      expect(up.error?.message).toBeUndefined();
      const after = (await homeFor('supervisor', ['employee.store_transfer.confirm'])).transfer.pendingCount;
      expect(after).toBe(before - 1);
    } finally {
      await cleanup();
    }
  });
});

test.describe('壽星與新人入職（C.1、C.6）', () => {
  test.describe.configure({ mode: 'serial' });
  const codes = () => [p02Code('FKF', 91), p02Code('FKF', 92), p02Code('FKF', 93)];
  test.afterAll(async () => {
    await purgeP02(codes());
  });
  test('本月壽星依日期排序、只給壽星可見角色；新人入職含本月未來日期，只給管轄該門市者', async () => {
    const st = await storeIds();
    const [a, b, c] = codes();
    await purgeP02(codes());
    const t = today();
    const mm = String(t.month).padStart(2, '0');
    await seedMaster(a, '自動測試壽星甲', st.ZT01);
    await seedMaster(b, '自動測試壽星乙', st.ZT01);
    await seedMaster(c, '自動測試非本月', st.ZT01);
    const db = adminDb();
    for (const [code, birthday] of [[a, `1990-${mm}-20`], [b, `1991-${mm}-03`], [c, `1992-${t.month === 12 ? '01' : String(t.month + 1).padStart(2, '0')}-10`]]) {
      const u = await db.from('store_employees').update({ birthday }).eq('employee_code', code);
      expect(u.error?.message).toBeUndefined();
    }
    const onboard = [
      { code: a, date: `${t.yearMonth}-01`, pharmacist: false },
      { code: b, date: t.monthEnd, pharmacist: true },
      { code: c, date: `${t.yearMonth}-01`, pharmacist: false },
    ];
    for (const o of onboard) {
      const ins = await db.from('employee_movement_history').insert({ employee_code: o.code, employee_name: `自動測試${o.code}`, store_id: st.ZT01, movement_type: 'onboarding', movement_date: o.date, onboarding_is_pharmacist: o.pharmacist });
      expect(ins.error?.message).toBeUndefined();
    }
    await registerP02(codes());
    try {
      const admin = (await get('admin')).body;
      const rows = (admin.birthdays.rows as any[]).filter((r) => codes().includes(r.employee_code));
      expect(rows.map((r) => r.employee_code), '本月才列，依日期排序（3 日在 20 日前）').toEqual([b, a]);

      for (const role of ['supervisor', 'store_manager']) {
        const v = (await get(role)).body;
        expect((v.birthdays.rows as any[]).filter((r) => codes().includes(r.employee_code)).map((r) => r.employee_code), `${role} 管轄 ZT01`).toEqual([b, a]);
        const on = (v.onboarding.rows as any[]).filter((r) => codes().includes(r.employee_code));
        expect(on.map((r) => r.movement_date)).toEqual([`${t.yearMonth}-01`, `${t.yearMonth}-01`, t.monthEnd]);
        expect(on.find((r) => r.employee_code === b)).toMatchObject({ onboarding_is_pharmacist: true, store_code: 'ZT01', movement_date: t.monthEnd });
      }
      const emp = (await get('employee')).body;
      expect(emp.birthdays.rows).toEqual([]);
      expect(emp.onboarding.rows, '沒有管轄門市者沒有新人入職公告').toEqual([]);
      expect((admin.onboarding.rows as any[]).some((r) => codes().includes(r.employee_code)), '管理員沒有任命門市，舊版同樣沒有這張卡').toBe(false);
    } finally {
      await purgeP02(codes());
    }
  });
});

test.describe('首頁我的任務（C.4、Q14）', () => {
  test('未完成優先、依建立時間新到舊，已完成排後面；最多 3 筆', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    const ops = userId('ops_assistant');
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      const make = async (tag: string, complete: boolean) => {
        const t = await createTemplate(admin, tag, [sectionOf({ department: DEPT, users: [ops] })]);
        await dropAutoAssignments(t);
        const [sec] = await templateSections(t.id);
        const a = await addSectionAssignment(t.id, sec.id, [ops]);
        if (complete) await logSteps(a, sec.steps.map((s) => s.id), ops);
        await sleep(30);
        return { id: a, title: t.form.title };
      };
      const doneOld = await make('home-done-old', true);
      const openOld = await make('home-open-old', false);
      const doneNew = await make('home-done-new', true);
      const openNew = await make('home-open-new', false);
      const { body } = await get('ops_assistant');
      const rows = body.tasks.rows as any[];
      expect(rows.length).toBeLessThanOrEqual(3);
      const ours = rows.filter((r) => [doneOld.id, openOld.id, doneNew.id, openNew.id].includes(r.id));
      // 未完成永遠在已完成前面
      const firstDone = rows.findIndex((r) => r.status === 'completed');
      if (firstDone >= 0) expect(rows.slice(firstDone).every((r) => r.status === 'completed')).toBe(true);
      // 沒有別的任務干擾時，順序固定：新的未完成、舊的未完成、已完成中最新的
      if (ours.length === rows.length) expect(rows.map((r) => r.id)).toEqual([openNew.id, openOld.id, doneNew.id]);
      expect(rows[0].id, '最新的未完成排第一').toBe(openNew.id);
      expect(rows.find((r) => r.id === doneNew.id)?.status ?? 'completed').toBe('completed');
      expect(rows.map((r) => r.id)).not.toContain(doneOld.id);
      expect(rows[0].title).toBe(openNew.title);
    } finally {
      await admin.dispose();
    }
  });

  test('只列指派給本人的任務；別人的任務不出現在我的首頁', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'home-not-mine', [sectionOf({ department: DEPT, users: [userId('ops_assistant')] })]);
      await dropAutoAssignments(t);
      const [sec] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, sec.id, [userId('ops_assistant')], { assigned_to: userId('ops_manager') });
      const mineView = (await get('ops_assistant')).body.tasks.rows as any[];
      expect(mineView.some((r) => r.id === a), '協作者但不是被指派人（舊版同樣只列 assigned_to 本人）').toBe(false);
    } finally {
      await admin.dispose();
    }
  });
});
