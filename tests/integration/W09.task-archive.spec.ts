import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, completeAssignment, createTemplate, deleteRunTemplates, runIdOrThrow, setAssignment, stepIds, userId } from '../support/m3-fixtures';

// W09 整合層：已封存任務（M3 A.4、A.5）。
//  - A.4 權限：維持新版「身分（管理員或主管）加 task.view_archived」；導覽入口只看 task.view_archived（approvals nav-archived-feature-gate 改回舊版）。
//  - A.5 封存任務詳情唯讀：封存後不能再勾選或改備註（task-detail 讀寫都 404），資料不動；要再做用「複製任務」。
// 測試資料：範本標題「[自動測試]M3 <runId> …」，由本測試建立並清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

const navHrefs = async (role: string) => {
  const api = await apiAs(role);
  try {
    const body = await (await api.get('/api/workspace/session')).json();
    return {
      hrefs: body.navigation.flatMap((g: { items: { href: string; allowed?: boolean }[] }) => g.items.map((i) => i.href)) as string[],
      taskArchive: body.capabilities.taskArchive as boolean,
    };
  } finally {
    await api.dispose();
  }
};

test('導覽入口：持有 task.view_archived 的人看得到「已封存任務」（navigation 帳號），沒有該權限碼的看不到（ops_manager、employee）；管理員看得到', async () => {
  runIdOrThrow();
  expect((await navHrefs('admin')).hrefs).toContain('/admin/archived');
  expect((await navHrefs('navigation')).hrefs).toContain('/admin/archived');
  expect((await navHrefs('ops_manager')).hrefs).not.toContain('/admin/archived');
  expect((await navHrefs('employee')).hrefs).not.toContain('/admin/archived');
  expect((await navHrefs('denied')).hrefs).not.toContain('/admin/archived');
});

test('頁面權限：身分加 task.view_archived。管理員 200；只有權限碼的一般成員、沒有權限碼的主管、一般員工、無權限者 403；未登入 401', async () => {
  const expected: Record<string, number> = { admin: 200, navigation: 403, ops_manager: 403, employee: 403, denied: 403 };
  for (const [role, status] of Object.entries(expected)) {
    const api = await apiAs(role);
    try {
      expect((await api.get('/api/workspace/task-archive')).status(), role).toBe(status);
    } finally {
      await api.dispose();
    }
  }
  const anon = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await anon.get('/api/workspace/task-archive')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('封存詳情唯讀：管理員讀得到封存紀錄，但不能再勾選或改備註；紀錄與版本都不變', async () => {
  const admin = await apiAs('admin');
  try {
    const t = await createTemplate(admin, 'archive-readonly');
    await completeAssignment(t.assignmentId, t.id, userId('admin'));
    await setAssignment(t.assignmentId, { archived: true, archived_by: userId('admin'), archived_at: new Date().toISOString() });

    const list = await (await admin.get('/api/workspace/task-archive')).json();
    expect((list.records as { id: string }[]).some((r) => r.id === t.assignmentId)).toBe(true);
    const detail = await admin.get('/api/workspace/task-archive', { params: { id: t.assignmentId } });
    expect(detail.status()).toBe(200);
    const d = await detail.json();
    expect(d.total).toBe(2);
    expect(d.done).toBe(2);

    const db = adminDb();
    const before = await db.from('assignments').select('workspace_version').eq('id', t.assignmentId).single();
    const logsBefore = await db.from('logs').select('id', { count: 'exact', head: true }).eq('assignment_id', t.assignmentId);
    const ids = await stepIds(t.id);
    // 讀取執行頁、取消勾選、改備註：全部 404
    expect((await admin.get('/api/workspace/task-detail', { params: { id: t.assignmentId } })).status()).toBe(404);
    for (const changes of [[{ stepId: ids[0], checked: false }], [{ stepId: ids[0], checked: true, note: '想改備註' }]]) {
      const res = await admin.post('/api/workspace/task-detail', {
        data: { id: t.assignmentId, writeId: randomUUID(), version: before.data.workspace_version, changes },
      });
      expect(res.status()).toBe(404);
    }
    const after = await db.from('assignments').select('workspace_version').eq('id', t.assignmentId).single();
    const logsAfter = await db.from('logs').select('id', { count: 'exact', head: true }).eq('assignment_id', t.assignmentId);
    expect(after.data.workspace_version).toBe(before.data.workspace_version);
    expect(logsAfter.count).toBe(logsBefore.count);
  } finally {
    await admin.dispose();
  }
});

test('封存詳情標示跨部門支援：協作者資料帶 support 旗標（A.6 與 A.5 交會）', async () => {
  const admin = await apiAs('admin');
  try {
    const { sectionOf, DEPT } = await import('../support/m3-fixtures');
    const t = await createTemplate(admin, 'archive-support', [sectionOf({ department: DEPT, users: [userId('ops_assistant')], support: [userId('ga_staff')] })]);
    await setAssignment(t.assignmentId, { archived: true, status: 'completed', archived_by: userId('admin'), archived_at: new Date().toISOString() });
    const d = await (await admin.get('/api/workspace/task-archive', { params: { id: t.assignmentId } })).json();
    const byId = new Map((d.collaborators as { user_id: string; support: boolean }[]).map((c) => [c.user_id, c.support]));
    expect(byId.get(userId('ga_staff'))).toBe(true);
    expect(byId.get(userId('ops_assistant'))).toBe(false);
  } finally {
    await admin.dispose();
  }
});
