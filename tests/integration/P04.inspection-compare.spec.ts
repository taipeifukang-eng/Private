import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { M4B_MONTH, activeTemplates, deleteRunMasters, seedMaster, seedResults } from '../support/m4b-fixtures';
import { runIdOrThrow } from '../support/m4-fixtures';
import { compareStatus } from '../../lib/workspace/inspection-compare';

// P04 整合層（M4 Q23）：督導與經理巡店比較。
//  權限：「巡店比較」與「經理巡店」兩個都要；只有其一或都沒有者 403。
//  差異判定：一邊沒有紀錄視為 0 扣分、扣分不同才標差異、只有兩邊都沒有才「缺少明細」。
//  範圍：門市限可見範圍；未完成的單不能拿來比。資料只用 ZT 測試門市與保留月份 2099。

const compare = (api: any, params: Record<string, string>) => api.get('/api/workspace/inspection-compare', { params });

test.afterAll(async () => {
  await deleteRunMasters();
});

test('權限：需要巡店比較＋經理巡店；沒有權限的角色 403', async () => {
  runIdOrThrow();
  const roles: [string, number][] = [
    ['admin', 200],
    ['ops_manager', 200],
    ['supervisor', 403], // 沒有「巡店比較」與「經理巡店」
    ['navigation', 403],
    ['inspection_view', 403],
    ['store_manager', 403],
    ['employee', 403],
    ['denied', 403],
  ];
  for (const [role, status] of roles) {
    const api = await apiAs(role);
    try {
      expect((await compare(api, {})).status(), role).toBe(status);
    } finally {
      await api.dispose();
    }
  }
});

test('差異判定：缺的一邊視為 0 扣分，扣分不同才標差異，兩邊都沒有才缺少明細；未完成的單不能比', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const t = await activeTemplates(6);
  const date = `${M4B_MONTH.compare}-05`;
  const sup = await seedMaster({ store: 'ZT04', inspector: 'supervisor', date, status: 'completed', total: 200, tag: 'p04-sup' });
  const mgr = await seedMaster({ store: 'ZT04', inspector: 'ops_manager', date: `${M4B_MONTH.compare}-06`, status: 'completed', total: 200, type: 'manager', tag: 'p04-mgr' });
  const draft = await seedMaster({ store: 'ZT04', inspector: 'ops_manager', date: `${M4B_MONTH.compare}-07`, status: 'draft', type: 'manager', tag: 'p04-draft' });
  // t0：5 vs 2 → 扣分不同；t1：0 vs 4 → 僅經理；t2：3 vs（無紀錄）→ 僅督導；t3：4 vs 4 → 相同；t4：0 vs 0 → 相同；t5：兩邊都沒有
  await seedResults(sup, [
    { template: t[0], deduction: 5 },
    { template: t[1], deduction: 0 },
    { template: t[2], deduction: 3 },
    { template: t[3], deduction: 4 },
    { template: t[4], deduction: 0 },
  ]);
  await seedResults(mgr, [
    { template: t[0], deduction: 2 },
    { template: t[1], deduction: 4 },
    { template: t[3], deduction: 4 },
    { template: t[4], deduction: 0 },
  ]);
  const api = await apiAs('ops_manager');
  try {
    const store = (await (await compare(api, {})).json()).stores.find((s: any) => s.store_code === 'ZT04').id;
    // 沒選紀錄：回兩邊的已完成清單（草稿不在清單內）
    const lists = await (await compare(api, { store })).json();
    expect(lists.supervisorRecords.some((r: any) => r.id === sup)).toBe(true);
    expect(lists.managerRecords.some((r: any) => r.id === mgr)).toBe(true);
    expect(lists.managerRecords.some((r: any) => r.id === draft), '草稿不能拿來比').toBe(false);
    const res = await compare(api, { store, supervisor: sup, manager: mgr });
    expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
    const data = await res.json();
    const status = (i: number) => data.items.find((x: any) => x.template.id === t[i].id).status;
    expect(status(0)).toBe('both_different');
    expect(status(1)).toBe('manager_only');
    expect(status(2)).toBe('supervisor_only');
    expect(status(3)).toBe('same');
    expect(status(4)).toBe('same');
    expect(status(5), '兩邊都沒有紀錄').toBe('missing');
    // 與純函式、舊版判定相同
    for (const item of data.items) expect(item.status).toBe(compareStatus(item.supervisor, item.manager));
    expect(data.supervisor.id).toBe(sup);
    expect(data.manager.id).toBe(mgr);
    // 草稿或把兩邊選成同一筆：不能比
    expect((await compare(api, { store, supervisor: sup, manager: draft })).status()).toBe(404);
    expect((await compare(api, { store, supervisor: sup, manager: sup })).status()).toBe(400);
    // 督導單不能放在經理欄位
    expect((await compare(api, { store, supervisor: mgr, manager: sup })).status()).toBe(404);
  } finally {
    await api.dispose();
  }
});
