import { expect, request as playwrightRequest, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { addSectionAssignment, createTemplate, deleteRunTemplates, logSteps, runIdOrThrow, templateSections, twoSections, userId } from '../support/m3-fixtures';

// W10 整合層（M3 B.4、B.5）：儀表板 API。
//  - 頁面權限：dashboard.view；沒有的人 403，未登入 401。
//  - 範圍：只列我參與的未封存任務；統計卡只給有管理門市者（舊版 managed-stores 規則），其他人 stats 為 null。
//  - 統計、狀態、進度一律以勾選紀錄推算的整體進度為準（與我的任務同一套算法），不看 assignments.status。
// 測試資料：範本標題「[自動測試]M3 <runId> …」，由本測試建立並清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

const get = async (role: string) => {
  const api = await apiAs(role);
  try {
    const res = await api.get('/api/workspace/dashboard');
    const body = await res.json().catch(() => ({}));
    return { status: () => res.status(), json: async () => body };
  } finally {
    await api.dispose();
  }
};

test('頁面權限：admin 與一般成員 200；沒有 dashboard.view 的 denied 403；未登入 401', async () => {
  runIdOrThrow();
  expect((await get('admin')).status()).toBe(200);
  expect((await get('ops_assistant')).status()).toBe(200);
  expect((await get('denied')).status()).toBe(403);
  const anon = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await anon.get('/api/workspace/dashboard')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('統計與進度以勾選為準：資料庫標已完成但只勾一半 = 進行中 25%；統計卡數字等於表格各狀態筆數（有管理門市者）', async () => {
  const admin = await apiAs('admin');
  try {
    const t = await createTemplate(admin, 'dash-progress', twoSections());
    const [secA, secB] = await templateSections(t.id);
    const adminId = userId('admin');
    const a = await addSectionAssignment(t.id, secA.id, [adminId], { status: 'completed' });
    await logSteps(a, [secA.steps[0].id], adminId);
    const b = await addSectionAssignment(t.id, secB.id, [adminId], { status: 'pending', department: '總務' });
    await logSteps(b, secB.steps.map((s) => s.id), adminId);

    const res = await admin.get('/api/workspace/dashboard');
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(d.name).toBe('測試系統管理員');
    const mine = (d.records as any[]).filter((r) => [a, b].includes(r.id));
    const ra = mine.find((r) => r.id === a);
    const rb = mine.find((r) => r.id === b);
    expect(ra).toMatchObject({ status: 'in_progress', percent: 25, overallDone: 1, overallTotal: 4 });
    expect(rb).toMatchObject({ status: 'in_progress', percent: 50, overallDone: 2, overallTotal: 4 });
    expect(Number.isNaN(Date.parse(ra.lastActivity))).toBe(false);

    expect(d.managesStores, '管理員視同有管理門市').toBe(true);
    const counts = (s: string) => (d.records as any[]).filter((r) => r.status === s).length;
    expect(d.stats).toEqual({ total: d.records.length, pending: counts('pending'), in_progress: counts('in_progress'), completed: counts('completed') });
  } finally {
    await admin.dispose();
  }
});

test('範圍只有我參與的任務；統計卡只給有管理門市者，沒有的人 stats 為 null（畫面改顯示本月人員狀態捷徑）', async () => {
  const admin = await apiAs('admin');
  try {
    const t = await createTemplate(admin, 'dash-scope', twoSections());
    const [secA] = await templateSections(t.id);
    const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
    const opsView = await (await get('ops_assistant')).json();
    expect((opsView.records as any[]).some((r) => r.id === a)).toBe(true);
    if (!opsView.managesStores) expect(opsView.stats).toBeNull();
    const eView = await (await get('employee')).json();
    expect((eView.records as any[]).some((r) => r.id === a), '不是參與者看不到').toBe(false);
  } finally {
    await admin.dispose();
  }
});

test('已封存任務不在儀表板', async () => {
  const admin = await apiAs('admin');
  try {
    const t = await createTemplate(admin, 'dash-archived', twoSections());
    const [secA] = await templateSections(t.id);
    const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')], { archived: true });
    const view = await (await get('ops_assistant')).json();
    expect((view.records as any[]).some((r) => r.id === a)).toBe(false);
  } finally {
    await admin.dispose();
  }
});
