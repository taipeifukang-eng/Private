import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, createTemplate, DEPT, deleteRunTemplates, formOf, runIdOrThrow, saveTemplate, sectionOf, stepOf, userId } from '../support/m3-fixtures';

// P03 整合層：任務建立、編輯、派發（M3 A.6、A.7）。
//  - A.6 部門限制：預設被指派人必須屬於所選部門（400）；明確標記「跨部門支援人員」才能加入其他部門的人，資料上標示在區段 support_users。
//  - 上限（50 區段、1000 項目）維持新版。
//  - 建立後的資料形狀（範本、指派、協作者）與舊版 createTemplateV2 的寫入對等，見 tests/parity/P03.task-create.spec.ts。
//  - A.7：派發不選人指派給自己、派發取代原協作者；編輯需管理權限。
// 測試資料：範本標題「[自動測試]M3 <runId> …」，由本測試建立並清除。

test.afterAll(async () => {
  await deleteRunTemplates();
});

const ops = () => userId('ops_assistant');
const ga = () => userId('ga_staff');
const err = async (res: { json: () => Promise<any> }) => (await res.json()).error as string;

test.describe('A.6 部門限制與跨部門支援人員', () => {
  test('被指派人不屬於所選部門：400，沒有建立任何範本', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const form = formOf('dept-strict', [sectionOf({ department: DEPT, users: [ops(), ga()] })]);
      const { res, json } = await saveTemplate(admin, form);
      expect(res.status()).toBe(400);
      expect(json.error).toMatch(/不屬於所選部門.*跨部門支援/);
      const found = await adminDb().from('templates').select('id').eq('title', form.title);
      expect(found.data).toHaveLength(0);
    } finally {
      await admin.dispose();
    }
  });

  test('只有「支援人員」清單裡的人可以跨部門；支援人員必須同時是執行人員；清單格式錯誤 400', async () => {
    const admin = await apiAs('admin');
    try {
      // 支援清單有、但不在 assigned_users
      let form = formOf('support-not-assigned', [sectionOf({ department: DEPT, users: [ops()] })]);
      (form.sections[0] as any).support_users = [ga()];
      let r = await saveTemplate(admin, form);
      expect(r.res.status()).toBe(400);
      expect(r.json.error).toMatch(/必須同時是執行人員/);
      // 格式錯
      form = formOf('support-bad-format', [sectionOf({ department: DEPT, users: [ops()] })]);
      (form.sections[0] as any).support_users = 'x';
      r = await saveTemplate(admin, form);
      expect(r.res.status()).toBe(400);
      // 不存在的人
      form = formOf('support-ghost', [sectionOf({ department: DEPT, users: [ops()], support: [randomUUID()] })]);
      r = await saveTemplate(admin, form);
      expect(r.res.status()).toBe(400);
    } finally {
      await admin.dispose();
    }
  });

  test('明確勾選跨部門支援人員：建立成功，範本區段資料標示 support_users，協作者包含該人；執行人員仍是營業部', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'support-ok', [sectionOf({ department: DEPT, users: [ops()], support: [ga()] })]);
      const db = adminDb();
      const tpl = await db.from('templates').select('sections,created_by').eq('id', t.id).single();
      expect(tpl.data.sections[0].support_users).toEqual([ga()]);
      expect(tpl.data.sections[0].assigned_users.sort()).toEqual([ops(), ga()].sort());
      const collab = await db.from('assignment_collaborators').select('user_id,section_id').eq('assignment_id', t.assignmentId);
      const ids = (collab.data as { user_id: string }[]).map((c) => c.user_id).sort();
      expect(ids).toEqual([userId('admin'), ops(), ga()].sort());
      // 管理明細標示跨部門支援
      const detail = await (await admin.get('/api/workspace/task-management', { params: { id: t.id } })).json();
      const support = (detail.records[0].collaborators as { user_id: string; support: boolean }[]).filter((c) => c.support).map((c) => c.user_id);
      expect(support).toEqual([ga()]);
    } finally {
      await admin.dispose();
    }
  });

  test('支援人員清單裡其實是同部門的人：不算跨部門，不會被標成支援；編輯時移除支援人員會同步移除協作者', async () => {
    const admin = await apiAs('admin');
    try {
      const form = formOf('support-same-dept', [sectionOf({ department: DEPT, users: [], support: [ops()] })]);
      const { res, json } = await saveTemplate(admin, form);
      expect(res.status(), JSON.stringify(json)).toBe(200);
      const tpl = await adminDb().from('templates').select('sections').eq('id', json.id).single();
      expect(tpl.data.sections[0].support_users).toEqual([]);

      const t = await createTemplate(admin, 'support-edit', [sectionOf({ department: DEPT, users: [ops()], support: [ga()] })]);
      const cur = await (await admin.get('/api/workspace/task-template', { params: { id: t.id } })).json();
      const section = JSON.parse(JSON.stringify(cur.template.sections[0]));
      section.assigned_users = [ops()];
      section.support_users = [];
      const save = await admin.post('/api/workspace/task-template', {
        data: { id: t.id, version: cur.template.workspace_version, versions: cur.versions, writeId: randomUUID(), form: { title: cur.template.title, description: 'x', planned_start_date: '', planned_end_date: '', sections: [section] } },
      });
      expect(save.status(), JSON.stringify(await save.json())).toBe(200);
      const collab = await adminDb().from('assignment_collaborators').select('user_id').eq('assignment_id', t.assignmentId);
      expect((collab.data as { user_id: string }[]).map((c) => c.user_id)).not.toContain(ga());
    } finally {
      await admin.dispose();
    }
  });

  test('資料庫層也擋：直接呼叫 RPC 把非本部門又沒標記支援的人塞進區段，INVALID_MEMBER', async () => {
    const admin = await apiAs('admin');
    try {
      const section = sectionOf({ department: DEPT, users: [ops(), ga()] });
      const form = { title: formOf('rpc-direct').title, description: '', planned_start_date: null, planned_end_date: null, sections: [section] };
      const r = await adminDb().rpc('workspace_save_task_template', { p_id: null, p_actor: userId('admin'), p_version: 0, p_versions: [], p_write: randomUUID(), p_hash: 'h', p_form: form });
      expect(r.error?.message || '').toMatch(/INVALID_MEMBER/);
      const ok = await adminDb().rpc('workspace_save_task_template', { p_id: null, p_actor: userId('admin'), p_version: 0, p_versions: [], p_write: randomUUID(), p_hash: 'h2', p_form: { ...form, title: formOf('rpc-direct-ok').title, sections: [{ ...section, support_users: [ga()] }] } });
      expect(ok.error, JSON.stringify(ok.error)).toBeNull();
    } finally {
      await admin.dispose();
    }
  });

  test('上限維持新版：51 個區段 400；1001 個項目 400；500 項仍可', async () => {
    const admin = await apiAs('admin');
    try {
      const many = Array.from({ length: 51 }, () => sectionOf({ department: DEPT, users: [ops()], steps: [stepOf('x')] }));
      let r = await saveTemplate(admin, formOf('limit-sections', many));
      expect(r.res.status()).toBe(400);
      const steps = Array.from({ length: 1001 }, (_, i) => stepOf(`s${i}`));
      r = await saveTemplate(admin, formOf('limit-steps', [sectionOf({ department: DEPT, users: [ops()], steps })]));
      expect(r.res.status()).toBe(400);
      expect(r.json.error).toMatch(/項目數量/);
      const fine = Array.from({ length: 500 }, (_, i) => stepOf(`s${i}`));
      r = await saveTemplate(admin, formOf('limit-ok', [sectionOf({ department: DEPT, users: [ops()], steps: fine })]));
      expect(r.res.status(), JSON.stringify(r.json)).toBe(200);
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('派發與編輯權限（A.7）', () => {
  const dispatch = async (admin: any, srcId: string, users: string[]) => {
    const g = await (await admin.get('/api/workspace/task-dispatch', { params: { id: srcId } })).json();
    return admin.post('/api/workspace/task-dispatch', {
      data: { id: srcId, writeId: randomUUID(), operation: 'assign', version: g.template.workspace_version, assignment: g.assignment ? { id: g.assignment.id, version: g.assignment.workspace_version } : null, users, start: null, end: null },
    });
  };
  const collabs = async (assignmentId: string) => ((await adminDb().from('assignment_collaborators').select('user_id').eq('assignment_id', assignmentId)).data as { user_id: string }[]).map((c) => c.user_id).sort();

  test('派發不選人：指派給自己；派發取代原協作者', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'dispatch-replace');
      let res = await dispatch(admin, t.id, []);
      expect(res.status(), JSON.stringify(await res.json())).toBe(200);
      expect(await collabs(t.assignmentId)).toEqual([userId('admin')]);
      res = await dispatch(admin, t.id, [userId('employee')]);
      expect(res.status()).toBe(200);
      expect(await collabs(t.assignmentId)).toEqual([userId('admin'), userId('employee')].sort());
      const a = await adminDb().from('assignments').select('assigned_to,status').eq('id', t.assignmentId).single();
      expect(a.data).toMatchObject({ assigned_to: userId('admin'), status: 'pending' });
    } finally {
      await admin.dispose();
    }
  });

  test('建立、編輯、派發都需要任務管理權限：一般員工、只有範本權限的成員、無權限者 403', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'perm-write');
      for (const role of ['employee', 'task_template_edit', 'denied']) {
        const api = await apiAs(role);
        try {
          const r = await saveTemplate(api, formOf(`perm-${role}`));
          expect(r.res.status(), `建立 ${role}`).toBe(403);
          expect((await api.get('/api/workspace/task-dispatch', { params: { id: t.id } })).status(), `派發讀取 ${role}`).toBe(403);
          const res = await api.post('/api/workspace/task-template', { data: { id: t.id, version: 0, versions: [], writeId: randomUUID(), form: formOf('x') } });
          expect(res.status(), `編輯 ${role}`).toBe(403);
        } finally {
          await api.dispose();
        }
      }
      const found = await adminDb().from('templates').select('id').like('title', `[自動測試]M3 ${runIdOrThrow()} perm-%`);
      expect((found.data as unknown[]).length, '只有 admin 建立的那一筆').toBe(1);
    } finally {
      await admin.dispose();
    }
  });

  test('編輯鎖定：已有完成的指派就不能編輯範本（409）', async () => {
    const admin = await apiAs('admin');
    try {
      const t = await createTemplate(admin, 'edit-lock');
      const { completeAssignment } = await import('../support/m3-fixtures');
      await completeAssignment(t.assignmentId, t.id, userId('admin'));
      const cur = await (await admin.get('/api/workspace/task-template', { params: { id: t.id } })).json();
      expect(cur.locked).toBe(true);
      const res = await admin.post('/api/workspace/task-template', {
        data: { id: t.id, version: cur.template.workspace_version, versions: cur.versions, writeId: randomUUID(), form: { ...formOf('edit-lock'), title: cur.template.title } },
      });
      expect(res.status()).toBe(409);
      expect(await err(res)).toMatch(/已有完成的指派紀錄/);
    } finally {
      await admin.dispose();
    }
  });
});
