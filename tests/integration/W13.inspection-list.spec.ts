import { expect, request as playwrightRequest, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { deleteRunMasters, M4_MONTH, runIdOrThrow, seedMaster, storeId } from '../support/m4-fixtures';
import { inspectionStats } from '../../lib/workspace/inspection-list';

// W13 整合層（M4 Q1–Q4）：GET /api/workspace/inspections。
//  Q1 只回所選月份；Q2 統計只算已完成、尚未巡店名單標有草稿未送出；
//  Q3 可見範圍＝舊版聯集（自己建立的、被指派門市、查看全部）；Q4 不帶 month 時回最新有資料的月份。
// 資料：VW/ZT 測試門市、保留月份 2099-03～2099-06；備註帶 ZT<runId>-M4 標記，測後只刪自己建立的。

const get = async (role: string, query: Record<string, string>) => {
  const api = await apiAs(role);
  try {
    const res = await api.get('/api/workspace/inspections', { params: query });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  } finally {
    await api.dispose();
  }
};

test.afterAll(async () => {
  await deleteRunMasters();
});

test('未登入 401；沒有任何巡店查看權限 403；經理巡店分頁沒有 manager_tab 403', async () => {
  runIdOrThrow();
  const anon = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await anon.get('/api/workspace/inspections?month=2099-03')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
  expect((await get('denied', { month: M4_MONTH.stats })).status).toBe(403);
  expect((await get('employee', { month: M4_MONTH.stats })).status).toBe(403);
  expect((await get('supervisor', { month: M4_MONTH.stats, type: 'manager' })).status).toBe(403);
  expect((await get('admin', { month: '2099-13' })).status).toBe(400);
});

test('Q1／Q2：只回所選月份；統計只算已完成；草稿與進行中另列；含改善加分與評級', async () => {
  const zt01 = await storeId('ZT01');
  const month = M4_MONTH.stats;
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${month}-05`, status: 'completed', total: 220, tag: 'stat-a' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${month}-06`, status: 'completed', total: 175, tag: 'stat-b', bonus: 3 });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${month}-07`, status: 'closed', total: 150, tag: 'stat-c' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${month}-08`, status: 'draft', tag: 'stat-d' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${month}-09`, status: 'in_progress', tag: 'stat-e' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${M4_MONTH.latest}-02`, status: 'completed', total: 220, tag: 'stat-other-month' });

  const r = await get('admin', { month, store: zt01, overview: 'true' });
  expect(r.status).toBe(200);
  expect(r.body.month).toBe(month);
  expect(r.body.records.length, '只回所選月份的 5 筆').toBe(5);
  expect(r.body.records.every((x: any) => x.inspection_date.startsWith(month))).toBe(true);
  expect(r.body.total).toBe(5);
  // 卡片口徑：已完成（含已結案）3 筆：評級 10、6（175，含改善 +3）、3 → 優秀 1、良好 1、需改善 1；舊版口徑會把草稿與進行中算進需改善。
  expect(inspectionStats(r.body.records)).toEqual({ total: 3, excellent: 1, good: 1, improve: 1 });
  expect(inspectionStats(r.body.records, true)).toEqual({ total: 5, excellent: 1, good: 1, improve: 3 });
  const withBonus = r.body.records.find((x: any) => Number(x.improvement_bonus) === 3);
  expect(withBonus, '含改善加分的單').toBeTruthy();
  expect(withBonus.grade).toBe('6');
  expect(Number(withBonus.total_score)).toBe(175);
  // 沒帶 overview 時只有分頁資料，也不算涵蓋名單
  const page = await get('admin', { month, store: zt01 });
  expect(page.status).toBe(200);
  expect(page.body.coverage ?? null).toBeNull();
});

test('Q2：只有草稿的門市留在「尚未巡店」並標有草稿未送出；有已完成單的才算已巡店', async () => {
  const month = M4_MONTH.stats;
  const zt02 = await storeId('ZT02');
  const zt03 = await storeId('ZT03');
  await seedMaster({ store: 'ZT02', inspector: 'admin', date: `${month}-10`, status: 'draft', tag: 'cov-draft-only' });
  await seedMaster({ store: 'ZT03', inspector: 'admin', date: `${month}-10`, status: 'draft', tag: 'cov-draft' });
  await seedMaster({ store: 'ZT03', inspector: 'admin', date: `${month}-11`, status: 'completed', total: 200, tag: 'cov-done' });

  const draftOnly = await get('admin', { month, store: zt02, overview: 'true' });
  expect(draftOnly.status).toBe(200);
  expect(draftOnly.body.coverage.visited.map((s: any) => s.id)).toEqual([]);
  expect(draftOnly.body.coverage.unvisited.map((s: any) => [s.id, s.has_draft])).toEqual([[zt02, true]]);

  const done = await get('admin', { month, store: zt03, overview: 'true' });
  expect(done.body.coverage.visited.map((s: any) => s.id)).toEqual([zt03]);
  expect(done.body.coverage.unvisited).toEqual([]);
});

test('Q4：不帶 month 時回最新有資料的月份，且只回該月紀錄；明確帶 month 時照該月', async () => {
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${M4_MONTH.stats}-12`, status: 'completed', total: 200, tag: 'latest-old' });
  await seedMaster({ store: 'ZT01', inspector: 'admin', date: `${M4_MONTH.latest}-20`, status: 'completed', total: 200, tag: 'latest-new' });
  for (const role of ['admin', 'ops_manager']) {
    const r = await get(role, { overview: 'true' });
    expect(r.status, role).toBe(200);
    expect(r.body.month, `${role} 預設月份`).toBe(M4_MONTH.latest);
    expect(r.body.records.every((x: any) => x.inspection_date.startsWith(M4_MONTH.latest))).toBe(true);
    expect(r.body.records.length).toBeGreaterThanOrEqual(1);
  }
  const explicit = await get('admin', { month: M4_MONTH.stats, store: await storeId('ZT01'), overview: 'true' });
  expect(explicit.body.month).toBe(M4_MONTH.stats);
  expect(explicit.body.records.every((x: any) => x.inspection_date.startsWith(M4_MONTH.stats))).toBe(true);
});

test('Q3：督導（查看自己＋查看門市）看到自己建立的、被指派門市所有人的單；看不到未指派門市他人的單；管理員全看', async () => {
  const month = M4_MONTH.scope;
  const byAdminAssigned = await seedMaster({ store: 'ZT02', inspector: 'admin', date: `${month}-03`, status: 'completed', total: 200, tag: 'scope-admin-assigned' });
  const byAdminOther = await seedMaster({ store: 'VW001', inspector: 'admin', date: `${month}-03`, status: 'completed', total: 200, tag: 'scope-admin-other' });
  const bySupOther = await seedMaster({ store: 'VW001', inspector: 'supervisor', date: `${month}-04`, status: 'completed', total: 200, tag: 'scope-sup-other' });
  const bySupAssigned = await seedMaster({ store: 'ZT01', inspector: 'supervisor', date: `${month}-04`, status: 'draft', tag: 'scope-sup-assigned' });

  const sup = await get('supervisor', { month, overview: 'true' });
  expect(sup.status).toBe(200);
  const supIds = sup.body.records.map((x: any) => x.id);
  expect(supIds).toEqual(expect.arrayContaining([byAdminAssigned, bySupOther, bySupAssigned]));
  expect(supIds, '未指派門市他人建立的單看不到').not.toContain(byAdminOther);

  const admin = await get('admin', { month, overview: 'true' });
  const adminIds = admin.body.records.map((x: any) => x.id);
  expect(adminIds).toEqual(expect.arrayContaining([byAdminAssigned, byAdminOther, bySupOther, bySupAssigned]));

  // 督導的門市下拉：被指派門市＋自己建立過巡店的門市（VW001）
  const api = await apiAs('supervisor');
  try {
    const s = await (await api.get('/api/workspace/session')).json();
    const codes = (s.stores || []).map((x: any) => x.store_code);
    expect(codes).toEqual(expect.arrayContaining(['ZT01', 'ZT02', 'ZT03', 'VW001']));
  } finally {
    await api.dispose();
  }
});
