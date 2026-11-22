import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import {
  addSectionAssignment,
  adminDb,
  assignmentRow,
  createTemplate,
  deleteRunTemplates,
  logRows,
  logSteps,
  runIdOrThrow,
  saveChecks,
  templateSections,
  twoSections,
  userId,
} from '../support/m3-fixtures';

// W08 整合層（M3 B.1、B.2、B.3、B.5）：任務執行與我的任務。
//  - B.1 管理者代為勾選：有任務管理權限者（系統管理員）能打開不是自己參與的任務並代為勾選，每筆紀錄標 proxy 並記錄代做者；
//        沒有任務管理權限的人（含只是主管、一般成員）仍是 404。
//  - B.2 去重保留有進度者。 B.3 所有區段完成才算已完成。 B.5 區段已變更：擋下並提示。
// 測試資料：範本標題「[自動測試]M3 <runId> …」，由本測試建立並清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

const mine = async (role: string) => {
  const api = await apiAs(role);
  try {
    const res = await api.get('/api/workspace/tasks');
    expect(res.status(), role).toBe(200);
    return (await res.json()).records as any[];
  } finally {
    await api.dispose();
  }
};

test.describe('F2 參與者兼管理者：代勾他區段才標代做', () => {
  test('管理員本身是營業部區段參與者：勾自己區段不標 proxy，勾總務區段標 proxy，同一次儲存可混合', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'f2-mixed', twoSections());
      const [secA, secB] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, secA.id, [userId('admin')]);

      const d = await (await admin.get('/api/workspace/task-detail', { params: { id: a } })).json();
      expect(d.proxy).toBe(false);
      expect(d.canProxyOthers).toBe(true);
      expect(d.groups.map((g: any) => g.department)).toEqual(['營業部', '總務']);
      expect(d.ownStepIds).toEqual(expect.arrayContaining(secA.steps.map((s) => s.id)));
      expect(d.ownStepIds).not.toContain(secB.steps[0].id);

      const own = secA.steps[0].id;
      const other = secB.steps[0].id;
      expect((await saveChecks(admin, a, [{ stepId: own, checked: true }])).status()).toBe(200);
      expect((await logRows(a))[0]).toMatchObject({ user_id: userId('admin'), step_id: own, proxy: false });

      const mix = await saveChecks(admin, a, [{ stepId: other, checked: true, note: '代勾' }, { stepId: secA.steps[1].id, checked: true }]);
      expect(mix.status(), JSON.stringify(await mix.json().catch(() => ({})))).toBe(200);
      const rows = await logRows(a);
      expect(rows.map((r) => [r.step_id, r.proxy])).toEqual([[own, false], [other, true], [secA.steps[1].id, false]]);
      const after = await (await admin.get('/api/workspace/task-detail', { params: { id: a } })).json();
      expect(after.logs.map((l: any) => l.proxy)).toEqual([false, true, false]);
    } finally {
      await admin.dispose();
    }
  });

  test('非管理者的參與者仍不能勾他區段，也看不到他區段，不能代勾；無權限者不會因此被放行', async () => {
    const admin = await apiAs('admin');
    const ops = await apiAs('ops_assistant');
    try {
      const t = await createTemplate(admin, 'f2-plain', twoSections());
      const [secA, secB] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
      const d = await (await ops.get('/api/workspace/task-detail', { params: { id: a } })).json();
      expect(d.canProxyOthers).toBe(false);
      expect(d.groups).toHaveLength(1);
      const bad = await saveChecks(ops, a, [{ stepId: secB.steps[0].id, checked: true }]);
      expect(bad.status()).toBe(400);
      expect(await logRows(a)).toHaveLength(0);
    } finally {
      await admin.dispose();
      await ops.dispose();
    }
  });
});

test.describe('B.1 管理者代為勾選並記錄代做者', () => {
  test('管理員打開非自己參與的任務：看得到全部區段，勾選寫入 proxy 紀錄（代做者是管理員）', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'proxy-write', twoSections());
      const [secA, secB] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);

      const res = await admin.get('/api/workspace/task-detail', { params: { id: a } });
      expect(res.status()).toBe(200);
      const d = await res.json();
      expect(d.proxy).toBe(true);
      expect(d.groups.map((g: any) => g.department)).toEqual(['營業部', '總務']);
      expect(d.steps).toHaveLength(4);
      expect(d.overall).toMatchObject({ overallTotal: 4, overallDone: 0, status: 'pending' });

      // 代為勾選別人區段（總務）的步驟
      const target = secB.steps[0].id;
      const save = await saveChecks(admin, a, [{ stepId: target, checked: true, note: '管理員代填備註' }]);
      expect(save.status(), JSON.stringify(await save.json().catch(() => ({})))).toBe(200);
      const rows = await logRows(a);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: userId('admin'), step_id: target, action: 'complete', proxy: true });
      expect((await assignmentRow(a)).status).toBe('in_progress');

      // 詳情的步驟紀錄顯示代做者與時間
      const after = await (await admin.get('/api/workspace/task-detail', { params: { id: a } })).json();
      expect(after.logs).toHaveLength(1);
      expect(after.logs[0]).toMatchObject({ proxy: true, actorName: '測試系統管理員', action: 'complete', note: '管理員代填備註' });
      expect(after.logs[0].created_at).toBeTruthy();

      // 代為取消與改備註也各記一筆
      expect((await saveChecks(admin, a, [{ stepId: target, checked: true, note: '改備註' }])).status()).toBe(200);
      expect((await saveChecks(admin, a, [{ stepId: target, checked: false }])).status()).toBe(200);
      const all = await logRows(a);
      expect(all.map((r) => [r.action, r.proxy])).toEqual([['complete', true], ['complete', true], ['uncomplete', true]]);
    } finally {
      await admin.dispose();
    }
  });

  test('參與者自己勾選不標 proxy；代做者的紀錄對參與者也看得到', async () => {
    const admin = await apiAs('admin');
    const ops = await apiAs('ops_assistant');
    try {
      const t = await createTemplate(admin, 'proxy-own', twoSections());
      const [secA, secB] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
      const own = secA.steps[0].id;
      const res = await saveChecks(ops, a, [{ stepId: own, checked: true }]);
      expect(res.status()).toBe(200);
      expect((await logRows(a))[0]).toMatchObject({ user_id: userId('ops_assistant'), proxy: false });

      // 參與者看不到別的區段的步驟，也不能勾選別人區段（不屬於可操作區段）
      const d = await (await ops.get('/api/workspace/task-detail', { params: { id: a } })).json();
      expect(d.proxy).toBe(false);
      expect(d.steps.map((s: any) => s.id)).toEqual(secA.steps.map((s) => s.id));
      const bad = await saveChecks(ops, a, [{ stepId: secB.steps[0].id, checked: true }]);
      expect(bad.status()).toBe(400);

      // 管理員代為勾選後，參與者讀到「由管理員代做」的紀錄
      expect((await saveChecks(admin, a, [{ stepId: secA.steps[1].id, checked: true }])).status()).toBe(200);
      const seen = await (await ops.get('/api/workspace/task-detail', { params: { id: a } })).json();
      expect(seen.logs.map((l: any) => [l.actorName, l.proxy])).toEqual([['測試營業助理', false], ['測試系統管理員', true]]);
    } finally {
      await admin.dispose();
      await ops.dispose();
    }
  });

  test('沒有任務管理權限的人打開別人的任務一律 404：營業主管（只是主管）、一般成員；未登入 401；寫入也不行', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'proxy-denied', twoSections());
      const [secA] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
      for (const role of ['ops_manager', 'employee', 'ga_staff', 'denied']) {
        const api = await apiAs(role);
        try {
          expect((await api.get('/api/workspace/task-detail', { params: { id: a } })).status(), role).toBeGreaterThanOrEqual(403);
          const res = await api.post('/api/workspace/task-detail', { data: { id: a, writeId: randomUUID(), version: 0, changes: [{ stepId: secA.steps[0].id, checked: true }] } });
          expect(res.status(), `${role} 寫入`).toBeGreaterThanOrEqual(403);
        } finally {
          await api.dispose();
        }
      }
      for (const role of ['ops_manager', 'employee', 'ga_staff']) {
        const api = await apiAs(role);
        try {
          expect((await api.get('/api/workspace/task-detail', { params: { id: a } })).status(), role).toBe(404);
        } finally {
          await api.dispose();
        }
      }
      expect(await logRows(a), '被擋下不得留下紀錄').toHaveLength(0);
      const anon = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN });
      try {
        expect((await anon.get('/api/workspace/task-detail', { params: { id: a } })).status()).toBe(401);
      } finally {
        await anon.dispose();
      }
    } finally {
      await admin.dispose();
    }
  });

  test('同一個寫入編號重送不會重複記錄（冪等），代做標記保留', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'proxy-idem', twoSections());
      const [secA] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
      const d = await (await admin.get('/api/workspace/task-detail', { params: { id: a } })).json();
      const data = { id: a, writeId: randomUUID(), version: d.workspace_version, changes: [{ stepId: secA.steps[0].id, checked: true }] };
      expect((await admin.post('/api/workspace/task-detail', { data })).status()).toBe(200);
      expect((await admin.post('/api/workspace/task-detail', { data })).status()).toBe(200);
      expect(await logRows(a)).toHaveLength(1);
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('B.3 已完成的判定：所有區段所有步驟完成', () => {
  test('自己的區段做完仍是進行中；另一區段也做完才是已完成；取消勾選退回進行中；我的進度只算自己區段', async () => {
    const admin = await apiAs('admin');
    const ops = await apiAs('ops_assistant');
    const ga = await apiAs('ga_staff');
    try {
      const t = await createTemplate(admin, 'complete-all', twoSections());
      const [secA, secB] = await templateSections(t.id);
      // 同一筆指派兩位協作者（營業部與總務各一個區段）才共享勾選狀態
      const shared = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')], { department: '營業部' });
      const ins = await adminDb().from('assignment_collaborators').insert({ assignment_id: shared, user_id: userId('ga_staff'), section_id: secB.id });
      expect(ins.error).toBeNull();

      const idsA = secA.steps.map((s) => s.id);
      const idsB = secB.steps.map((s) => s.id);
      const row = async (api: any) => ((await (await api.get('/api/workspace/tasks')).json()).records as any[]).find((r) => r.id === shared);

      expect((await saveChecks(ops, shared, idsA.map((stepId) => ({ stepId, checked: true })))).status()).toBe(200);
      let r = await row(ops);
      expect(r).toMatchObject({ done: 2, total: 2, overallDone: 2, overallTotal: 4, status: 'in_progress' });
      expect((await assignmentRow(shared)).status, '資料庫狀態也不得提前變成已完成').toBe('in_progress');

      expect((await saveChecks(ga, shared, idsB.map((stepId) => ({ stepId, checked: true })))).status()).toBe(200);
      r = await row(ga);
      expect(r).toMatchObject({ done: 2, total: 2, overallDone: 4, overallTotal: 4, status: 'completed', percent: 100 });
      const done = await assignmentRow(shared);
      expect(done.status).toBe('completed');
      expect(done.completed_at).toBeTruthy();

      expect((await saveChecks(ga, shared, [{ stepId: idsB[0], checked: false }])).status()).toBe(200);
      r = await row(ops);
      expect(r).toMatchObject({ done: 2, total: 2, overallDone: 3, status: 'in_progress' });
      const back = await assignmentRow(shared);
      expect(back.status).toBe('in_progress');
      expect(back.completed_at).toBeNull();
    } finally {
      await admin.dispose();
      await ops.dispose();
      await ga.dispose();
    }
  });

  test('列表的狀態只看勾選紀錄：資料庫標成已完成但沒有任何勾選，列表仍顯示待處理', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'status-from-logs', twoSections());
      const [secA] = await templateSections(t.id);
      const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')], { status: 'completed' });
      const r = (await mine('ops_assistant')).find((x) => x.id === a);
      expect(r).toMatchObject({ status: 'pending', dbStatus: 'completed', overallDone: 0 });
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('B.2 我的任務去重：保留有進度者', () => {
  test('同範本、同部門、同區段：有進度的兩筆都顯示並標 multiple，沒動過的重複卡片收起', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'dedupe-progress', twoSections());
      const [secA] = await templateSections(t.id);
      const opsId = userId('ops_assistant');
      const first = await addSectionAssignment(t.id, secA.id, [opsId]);
      await logSteps(first, [secA.steps[0].id], opsId);
      const second = await addSectionAssignment(t.id, secA.id, [opsId]);
      await logSteps(second, [secA.steps[1].id], opsId);
      const idle = await addSectionAssignment(t.id, secA.id, [opsId]);

      const rows = (await mine('ops_assistant')).filter((r) => [first, second, idle].includes(r.id));
      expect(rows.map((r) => r.id).sort()).toEqual([first, second].sort());
      expect(rows.every((r) => r.multiple === true)).toBe(true);
      expect(rows.map((r) => r.overallDone)).toEqual([1, 1]);
    } finally {
      await admin.dispose();
    }
  });

  test('只有最舊那筆有進度：顯示它，較新的空卡片收起（舊版會留最新那筆）', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'dedupe-old-progress', twoSections());
      const [secA] = await templateSections(t.id);
      const opsId = userId('ops_assistant');
      const old = await addSectionAssignment(t.id, secA.id, [opsId]);
      await logSteps(old, [secA.steps[0].id], opsId);
      const fresh = await addSectionAssignment(t.id, secA.id, [opsId]);
      const rows = (await mine('ops_assistant')).filter((r) => [old, fresh].includes(r.id));
      expect(rows.map((r) => r.id)).toEqual([old]);
      expect(rows[0].multiple).toBe(false);
    } finally {
      await admin.dispose();
    }
  });

  test('都沒動過：只留最新一筆；不同區段或不同部門各自保留', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'dedupe-idle', twoSections());
      const [secA, secB] = await templateSections(t.id);
      const opsId = userId('ops_assistant');
      const one = await addSectionAssignment(t.id, secA.id, [opsId]);
      const two = await addSectionAssignment(t.id, secA.id, [opsId]);
      const otherSection = await addSectionAssignment(t.id, secB.id, [opsId]);
      const otherDept = await addSectionAssignment(t.id, secA.id, [opsId], { department: '總務' });
      const ids = [one, two, otherSection, otherDept];
      const rows = (await mine('ops_assistant')).filter((r) => ids.includes(r.id));
      expect(rows.map((r) => r.id).sort()).toEqual([two, otherSection, otherDept].sort());
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('B.5 區段已變更', () => {
  test('區段被改掉或刪除：列表標 sectionChanged，開啟被擋下並提示聯絡派發人', async () => {
    const admin = await apiAs('admin');
    const ops = await apiAs('ops_assistant');
    try {
      const t = await createTemplate(admin, 'section-changed', twoSections());
      const gone = await addSectionAssignment(t.id, randomUUID(), [userId('ops_assistant')]);
      const r = (await mine('ops_assistant')).find((x) => x.id === gone);
      expect(r).toMatchObject({ sectionChanged: true, total: 0, done: 0 });
      const res = await ops.get('/api/workspace/task-detail', { params: { id: gone } });
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toMatch(/區段已變更，請聯絡派發人員/);
    } finally {
      await admin.dispose();
      await ops.dispose();
    }
  });
});
