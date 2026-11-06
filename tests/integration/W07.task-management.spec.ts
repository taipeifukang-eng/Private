import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import {
  addAssignment,
  adminDb,
  auditRows,
  completeAssignment,
  countRows,
  createTemplate,
  deleteRunTemplates,
  runIdOrThrow,
  setAssignment,
  templateExists,
  userId,
} from '../support/m3-fixtures';

// W07 整合層：任務流程模板管理（M3 A.1、A.2、A.3、A.7）。
//  - A.1 刪除模板：有待處理／進行中的未封存任務就擋（409，資料完全沒動）；標題不符 400；可刪時連帶指派、勾選紀錄、協作者一併刪除。
//  - A.2 刪除已完成任務：只有已完成可刪；稽核紀錄與刪除同一交易；重複刪除只會成功一次。
//  - A.3 模板列表：範圍內全部顯示；沒有未封存任務的標示 unassigned。
//  - A.7 模板詳情：範圍內全部未封存任務（不只本人參與）。
// 測試資料：範本標題「[自動測試]M3 <runId> …」，全部由本測試建立並清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

const del = (api: any, data: Record<string, unknown>) => api.delete('/api/workspace/task-management', { data });

test.describe('A.1 刪除流程模板', () => {
  test('底下有待處理任務：409 擋下，範本、指派、勾選紀錄、協作者都還在', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'del-blocked');
      const before = await countRows('assignment_collaborators', 'assignment_id', [t.assignmentId]);
      const res = await del(admin, { kind: 'template', id: t.id, title: t.form.title });
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toMatch(/還有待處理或進行中/);
      expect(await templateExists(t.id)).toBe(true);
      expect(await countRows('assignment_collaborators', 'assignment_id', [t.assignmentId])).toBe(before);
      expect(await auditRows({ template_id: t.id }), '被擋下不得留下稽核紀錄').toHaveLength(0);
    } finally {
      await admin.dispose();
    }
  });

  test('進行中任務同樣擋下；封存或完成之後才可刪', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'del-in-progress');
      await setAssignment(t.assignmentId, { status: 'in_progress' });
      let res = await del(admin, { kind: 'template', id: t.id, title: t.form.title });
      expect(res.status()).toBe(409);
      // 完成但尚未封存：不算「待處理或進行中」，可刪
      await completeAssignment(t.assignmentId, t.id, userId('admin'));
      res = await del(admin, { kind: 'template', id: t.id, title: t.form.title });
      expect(res.status(), JSON.stringify(await res.json())).toBe(200);
      expect(await templateExists(t.id)).toBe(false);
    } finally {
      await admin.dispose();
    }
  });

  test('標題輸入不符（含多餘空白、大小寫）一律 400，資料不動；完全相符才刪，並連帶刪除指派、勾選紀錄、協作者', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'del-title');
      await completeAssignment(t.assignmentId, t.id, userId('admin'));
      const second = await addAssignment(t.id, { status: 'completed', archived: true }, [userId('employee')]);
      for (const typed of ['', 'wrong', `${t.form.title} `, t.form.title.toLowerCase(), undefined]) {
        const res = await del(admin, { kind: 'template', id: t.id, title: typed });
        expect(res.status(), `輸入 ${JSON.stringify(typed)}`).toBe(400);
      }
      expect(await templateExists(t.id)).toBe(true);
      expect(await countRows('logs', 'assignment_id', [t.assignmentId])).toBeGreaterThan(0);

      const res = await del(admin, { kind: 'template', id: t.id, title: t.form.title });
      expect(res.status(), JSON.stringify(await res.json())).toBe(200);
      expect(await templateExists(t.id)).toBe(false);
      expect(await countRows('assignments', 'id', [t.assignmentId, second])).toBe(0);
      expect(await countRows('logs', 'assignment_id', [t.assignmentId, second])).toBe(0);
      expect(await countRows('assignment_collaborators', 'assignment_id', [t.assignmentId, second])).toBe(0);
      const audit = await auditRows({ template_id: t.id });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ kind: 'template', actor_id: userId('admin'), template_title: t.form.title });
      expect(audit[0].summary).toMatchObject({ assignment_count: 2, completed_count: 2, archived_count: 1 });
    } finally {
      await admin.dispose();
    }
  });

  test('不存在的範本 404；id 格式錯誤 400；未知 kind 400', async () => {
    const admin = await apiAs('admin');
    try {
      expect((await del(admin, { kind: 'template', id: randomUUID(), title: 'x' })).status()).toBe(404);
      expect((await del(admin, { kind: 'template', id: 'abc', title: 'x' })).status()).toBe(400);
      expect((await del(admin, { kind: 'nope', id: randomUUID() })).status()).toBe(400);
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('A.2 刪除已完成任務（含稽核紀錄）', () => {
  test('未完成的任務不能刪（409），已完成的可刪，稽核紀錄記錄誰、何時、哪個範本與任務摘要', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'del-assignment');
      let res = await del(admin, { kind: 'assignment', id: t.assignmentId });
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toMatch(/只能刪除已完成/);
      expect(await countRows('assignments', 'id', [t.assignmentId])).toBe(1);
      expect(await auditRows({ assignment_id: t.assignmentId })).toHaveLength(0);

      await completeAssignment(t.assignmentId, t.id, userId('admin'));
      const logsBefore = await countRows('logs', 'assignment_id', [t.assignmentId]);
      const collabBefore = await countRows('assignment_collaborators', 'assignment_id', [t.assignmentId]);
      expect(logsBefore).toBe(2);
      expect(collabBefore).toBeGreaterThanOrEqual(2);
      const started = Date.now();
      res = await del(admin, { kind: 'assignment', id: t.assignmentId });
      expect(res.status(), JSON.stringify(await res.json())).toBe(200);
      expect(await countRows('assignments', 'id', [t.assignmentId])).toBe(0);
      expect(await countRows('logs', 'assignment_id', [t.assignmentId])).toBe(0);
      expect(await countRows('assignment_collaborators', 'assignment_id', [t.assignmentId])).toBe(0);
      expect(await templateExists(t.id), '刪任務不刪範本').toBe(true);

      const audit = await auditRows({ assignment_id: t.assignmentId });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ kind: 'assignment', actor_id: userId('admin'), template_id: t.id, template_title: t.form.title });
      expect(Math.abs(Date.parse(audit[0].deleted_at) - started)).toBeLessThan(60_000);
      expect(audit[0].summary).toMatchObject({ log_count: 2, collaborator_count: collabBefore });
      expect(audit[0].summary).toHaveProperty('department');
      expect(audit[0].summary.collaborators.length).toBe(collabBefore);
    } finally {
      await admin.dispose();
    }
  });

  test('同一筆同時刪兩次：一次成功一次 404，稽核紀錄只有一筆', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'del-race');
      await completeAssignment(t.assignmentId, t.id, userId('admin'));
      const [a, b] = await Promise.all([del(admin, { kind: 'assignment', id: t.assignmentId }), del(admin, { kind: 'assignment', id: t.assignmentId })]);
      expect([a.status(), b.status()].sort()).toEqual([200, 404]);
      expect(await auditRows({ assignment_id: t.assignmentId })).toHaveLength(1);
    } finally {
      await admin.dispose();
    }
  });

  test('模板列表選單「刪除已完成任務」：全部刪除並各留一筆稽核；沒有已完成的不動', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'del-completed-bulk');
      const second = await addAssignment(t.id, { status: 'pending' }, [userId('employee')]);
      await completeAssignment(t.assignmentId, t.id, userId('admin'));
      const res = await del(admin, { kind: 'completed', id: t.id });
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({ deleted: 1, failed: 0 });
      expect(await countRows('assignments', 'id', [second]), '未完成的不能被刪').toBe(1);
      expect(await auditRows({ template_id: t.id })).toHaveLength(1);
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('權限', () => {
  test('未登入 401；非管理角色（一般員工、只有刪除範本權限的成員、營業部主管但沒有 task.manage）一律 403，資料不動', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'del-perm');
      await completeAssignment(t.assignmentId, t.id, userId('admin'));
      const anon = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
      try {
        expect((await del(anon, { kind: 'assignment', id: t.assignmentId })).status()).toBe(401);
      } finally {
        await anon.dispose();
      }
      for (const role of ['employee', 'task_template_delete', 'ops_manager', 'denied']) {
        const api = await apiAs(role);
        try {
          for (const body of [
            { kind: 'assignment', id: t.assignmentId },
            { kind: 'template', id: t.id, title: t.form.title },
            { kind: 'completed', id: t.id },
          ]) {
            const res = await del(api, body);
            expect(res.status(), `${role} ${body.kind}`).toBe(403);
          }
        } finally {
          await api.dispose();
        }
      }
      expect(await templateExists(t.id)).toBe(true);
      expect(await countRows('assignments', 'id', [t.assignmentId])).toBe(1);
    } finally {
      await admin.dispose();
    }
  });

  test('沒有 Origin 的刪除請求被擋（403）', async () => {
    const raw = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN });
    try {
      const res = await raw.delete('/api/workspace/task-management', { data: { kind: 'assignment', id: randomUUID() } });
      expect([401, 403]).toContain(res.status());
    } finally {
      await raw.dispose();
    }
  });
});

test.describe('A.3 模板列表與 A.7 詳情範圍', () => {
  test('列表：剛建立的模板立即可見；只有封存任務的模板仍列出並標示 unassigned', async () => {
    const admin = await apiAs('admin');
    try {
      const fresh = await createTemplate(admin, 'list-fresh');
      const archivedOnly = await createTemplate(admin, 'list-archived-only');
      await setAssignment(archivedOnly.assignmentId, { archived: true, status: 'completed', archived_by: userId('admin'), archived_at: new Date().toISOString() });
      const res = await admin.get('/api/workspace/task-management');
      expect(res.status()).toBe(200);
      const rows = (await res.json()).records as any[];
      const a = rows.find((r) => r.id === fresh.id);
      const b = rows.find((r) => r.id === archivedOnly.id);
      expect(a, '剛建立的模板要立即出現').toBeTruthy();
      expect(a).toMatchObject({ count: 1, unassigned: false, canDelete: true });
      expect(b, '沒有未封存任務的模板也要列出').toBeTruthy();
      expect(b).toMatchObject({ count: 0, unassigned: true, total: 0, done: 0 });
    } finally {
      await admin.dispose();
    }
  });

  test('複製模板後立即出現在列表（複製會建立一筆指派）', async () => {
    const admin = await apiAs('admin');
    try {
      const src = await createTemplate(admin, 'list-copy-src');
      const t = (await (await admin.get('/api/workspace/task-dispatch', { params: { id: src.id } })).json()) as any;
      const title = `${src.form.title} 副本`;
      const res = await admin.post('/api/workspace/task-dispatch', {
        data: { id: src.id, writeId: randomUUID(), operation: 'copy', version: t.template.workspace_version, assignment: { id: t.assignment.id, version: t.assignment.workspace_version }, title },
      });
      expect(res.status(), JSON.stringify(await res.json())).toBe(200);
      const rows = ((await (await admin.get('/api/workspace/task-management')).json()).records as any[]).filter((r) => r.title === title);
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(1);
    } finally {
      await admin.dispose();
    }
  });

  test('詳情：範圍內全部未封存任務都列出（包含管理者本人沒參與的），已封存的不列；詳情帶刪除權限旗標', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'detail-scope');
      const others = await addAssignment(t.id, { status: 'in_progress', department: '營業部' }, [userId('employee')]);
      const archived = await addAssignment(t.id, { status: 'completed', archived: true }, [userId('employee')]);
      // 管理者（admin）不是 others 的協作者
      const mine = await adminDb().from('assignment_collaborators').select('user_id').eq('assignment_id', others).eq('user_id', userId('admin'));
      expect(mine.data).toHaveLength(0);
      const res = await admin.get('/api/workspace/task-management', { params: { id: t.id } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      const ids = (body.records as { id: string }[]).map((r) => r.id);
      expect(ids).toContain(t.assignmentId);
      expect(ids).toContain(others);
      expect(ids).not.toContain(archived);
      expect(body).toMatchObject({ canDeleteAssignment: true, canDeleteTemplate: true });
      expect(body.records.find((r: any) => r.id === others).status).toBe('in_progress');
    } finally {
      await admin.dispose();
    }
  });
});
