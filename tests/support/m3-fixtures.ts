import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

// M3（W07 / W09 / P03）任務測試共用工具。
// 資料原則：範本標題一律「[自動測試]M3 <runId> <tag>」；測試只建立、讀取、刪除自己建立的範本（沒有 like 2099 之類的大量刪除）。
// 執行人員只用角色矩陣帳號（營業部：ops_assistant、ops_manager；總務：ga_staff 作為跨部門支援人員）。
// 範本底下的 assignments 沒有 cascade，所以清理時依範本 id 先刪 logs、協作者、指派，最後才刪範本與稽核紀錄；sweeper 以標題前綴做後備清除。

const nodeRequire = createRequire(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RUN_ID_RE } = nodeRequire('./registry.cjs') as { RUN_ID_RE: RegExp };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccount } = nodeRequire('./credentials.cjs') as { getAccount: (key: string) => { email: string; password: string; userId?: string } };

export function runIdOrThrow(): string {
  const runId = process.env.TEST_RUN_ID || '';
  if (!RUN_ID_RE.test(runId)) throw new Error('必須由 run-all 啟動（需要 TEST_RUN_ID）');
  return runId;
}
export const m3Title = (tag: string) => `[自動測試]M3 ${runIdOrThrow()} ${tag}`;
export const m3Prefix = () => `[自動測試]M3 ${runIdOrThrow()}`;

export function userId(key: string): string {
  const id = getAccount(key).userId;
  if (!id) throw new Error(`${key} 測試帳號缺少 userId`);
  return id;
}

export function adminDb(): any {
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const stepOf = (label: string, over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  label,
  description: '',
  required: true,
  planned_start_date: '',
  planned_end_date: '',
  subSteps: [] as unknown[],
  ...over,
});

export interface SectionInput {
  department: string;
  users: string[];
  support?: string[];
  steps?: ReturnType<typeof stepOf>[];
}
export function sectionOf(s: SectionInput) {
  return {
    id: randomUUID(),
    department: s.department,
    assigned_users: [...s.users, ...(s.support || [])],
    ...(s.support ? { support_users: s.support } : {}),
    steps: s.steps || [stepOf('步驟一'), stepOf('步驟二')],
  };
}

export const DEPT = '營業部';
/** 預設表單：一個營業部區段，成員 ops_assistant。 */
export function formOf(tag: string, sections?: ReturnType<typeof sectionOf>[]) {
  return {
    title: m3Title(tag),
    description: '自動測試範本',
    planned_start_date: '',
    planned_end_date: '',
    sections: sections || [sectionOf({ department: DEPT, users: [userId('ops_assistant')] })],
  };
}

export async function saveTemplate(admin: APIRequestContext, form: ReturnType<typeof formOf>) {
  const res = await admin.post('/api/workspace/task-template', { data: { id: null, version: 0, versions: [], writeId: randomUUID(), form } });
  return { res, json: (await res.json().catch(() => ({}))) as any };
}
/** 建立範本並回傳 { id, assignmentId }（建立時會自動建立一筆 pending 指派，執行人員與建立者都是協作者）。 */
export async function createTemplate(admin: APIRequestContext, tag: string, sections?: ReturnType<typeof sectionOf>[]) {
  const form = formOf(tag, sections);
  const { res, json } = await saveTemplate(admin, form);
  expect(res.status(), `建立範本 ${tag}：${JSON.stringify(json)}`).toBe(200);
  const a = await adminDb().from('assignments').select('id').eq('template_id', json.id);
  if (a.error) throw new Error(a.error.message);
  return { id: json.id as string, form, assignmentId: (a.data[0]?.id as string) || '', assignmentIds: (a.data as { id: string }[]).map((r) => r.id) };
}

export async function stepIds(templateId: string): Promise<string[]> {
  const t = await adminDb().from('templates').select('sections,steps_schema').eq('id', templateId).single();
  if (t.error) throw new Error(t.error.message);
  const steps = (t.data.sections || []).flatMap((s: any) => s.steps || []);
  return steps.flatMap((s: any) => [s.id, ...(s.subSteps || []).map((x: any) => x.id)]);
}

/** 把指派標為已完成：每個項目寫 complete 紀錄，並更新 status / completed_at。 */
export async function completeAssignment(assignmentId: string, templateId: string, by: string) {
  const db = adminDb();
  const ids = await stepIds(templateId);
  const logs = ids.map((id, i) => ({ assignment_id: assignmentId, user_id: by, step_id: id, action: 'complete', note: `自動測試備註${i}` }));
  const ins = await db.from('logs').insert(logs);
  if (ins.error) throw new Error(ins.error.message);
  const up = await db.from('assignments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', assignmentId);
  if (up.error) throw new Error(up.error.message);
}
export async function setAssignment(assignmentId: string, patch: Record<string, unknown>) {
  const up = await adminDb().from('assignments').update(patch).eq('id', assignmentId);
  if (up.error) throw new Error(up.error.message);
}
export async function addAssignment(templateId: string, over: Record<string, unknown> = {}, collaborators: string[] = []) {
  const db = adminDb();
  const by = userId('admin');
  const ins = await db.from('assignments').insert({ template_id: templateId, assigned_to: by, created_by: by, status: 'pending', archived: false, department: DEPT, ...over }).select('id').single();
  if (ins.error) throw new Error(ins.error.message);
  if (collaborators.length) {
    const c = await db.from('assignment_collaborators').insert(collaborators.map((u) => ({ assignment_id: ins.data.id, user_id: u, section_id: null })));
    if (c.error) throw new Error(c.error.message);
  }
  return ins.data.id as string;
}

export async function templateExists(id: string) {
  const r = await adminDb().from('templates').select('id').eq('id', id).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return !!r.data;
}
export async function countRows(table: string, column: string, values: string[]) {
  if (!values.length) return 0;
  const r = await adminDb().from(table).select(column, { count: 'exact', head: true }).in(column, values);
  if (r.error) throw new Error(r.error.message);
  return (r.count as number) || 0;
}
export async function auditRows(filter: { template_id?: string; assignment_id?: string }) {
  let q = adminDb().from('workspace_task_delete_audit').select('*');
  if (filter.template_id) q = q.eq('template_id', filter.template_id);
  if (filter.assignment_id) q = q.eq('assignment_id', filter.assignment_id);
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data as Record<string, any>[];
}

/** 只刪本次 run 建立的範本（標題前綴帶 runId）：先子表再範本，最後稽核紀錄。 */
export async function deleteRunTemplates() {
  const db = adminDb();
  const found = await db.from('templates').select('id').like('title', `${m3Prefix()}%`);
  if (found.error) throw new Error(`清理範本查詢失敗：${found.error.message}`);
  const tids = (found.data as { id: string }[]).map((r) => r.id);
  if (tids.length) {
    const a = await db.from('assignments').select('id').in('template_id', tids);
    if (a.error) throw new Error(a.error.message);
    const aids = (a.data as { id: string }[]).map((r) => r.id);
    if (aids.length) {
      for (const t of ['logs', 'assignment_collaborators']) {
        const d = await db.from(t).delete().in('assignment_id', aids);
        if (d.error) throw new Error(`清理 ${t} 失敗：${d.error.message}`);
      }
      const d = await db.from('assignments').delete().in('id', aids);
      if (d.error) throw new Error(`清理指派失敗：${d.error.message}`);
    }
    const d = await db.from('templates').delete().in('id', tids);
    if (d.error) throw new Error(`清理範本失敗：${d.error.message}`);
  }
  const au = await db.from('workspace_task_delete_audit').delete().like('template_title', `${m3Prefix()}%`);
  if (au.error) throw new Error(`清理稽核紀錄失敗：${au.error.message}`);
}

/** 從全站功能選單開啟新版頁面（依選單標題）。 */
export async function openFromMenu(page: Page, title: string) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator(`.workspace-menu button.catalog-item[title="${title}"]`).click();
}

// ---- M3 B（W08 / W10）共用工具 ----
export const GA_DEPT = '總務';
/** 兩個區段的範本：營業部（ops_assistant）與總務（ga_staff），每區段兩個步驟。 */
export function twoSections() {
  return [
    sectionOf({ department: DEPT, users: [userId('ops_assistant')] }),
    sectionOf({ department: GA_DEPT, users: [userId('ga_staff')] }),
  ];
}
export async function templateSections(templateId: string) {
  const t = await adminDb().from('templates').select('sections').eq('id', templateId).single();
  if (t.error) throw new Error(t.error.message);
  return t.data.sections as { id: string; department: string; steps: { id: string; subSteps?: { id: string }[] }[] }[];
}
/** 直接新增一筆指派（指定區段與協作者）；回傳指派 id。管理員不是協作者，所以管理員打開它就是「代做者」。 */
export async function addSectionAssignment(templateId: string, sectionId: string | null, users: string[], over: Record<string, unknown> = {}) {
  const db = adminDb();
  const by = userId('admin');
  const ins = await db.from('assignments').insert({ template_id: templateId, assigned_to: users[0] || by, created_by: by, status: 'pending', archived: false, department: DEPT, ...over }).select('id').single();
  if (ins.error) throw new Error(ins.error.message);
  const c = await db.from('assignment_collaborators').insert(users.map((u) => ({ assignment_id: ins.data.id, user_id: u, section_id: sectionId })));
  if (c.error) throw new Error(c.error.message);
  return ins.data.id as string;
}
/** 對指定步驟寫入勾選紀錄（不改 assignments.status，用來模擬舊資料或別人已勾過）。 */
export async function logSteps(assignmentId: string, stepIdList: string[], by: string, action: 'complete' | 'uncomplete' = 'complete') {
  const r = await adminDb().from('logs').insert(stepIdList.map((id) => ({ assignment_id: assignmentId, user_id: by, step_id: id, action, note: null })));
  if (r.error) throw new Error(r.error.message);
}
export async function logRows(assignmentId: string) {
  const r = await adminDb().from('logs').select('user_id,step_id,action,proxy,created_at').eq('assignment_id', assignmentId).order('created_at');
  if (r.error) throw new Error(r.error.message);
  return r.data as { user_id: string; step_id: string; action: string; proxy: boolean; created_at: string }[];
}
export async function assignmentRow(assignmentId: string) {
  const r = await adminDb().from('assignments').select('status,completed_at,workspace_version').eq('id', assignmentId).single();
  if (r.error) throw new Error(r.error.message);
  return r.data as { status: string; completed_at: string | null; workspace_version: number };
}
/** 儲存勾選（走 POST /api/workspace/task-detail）。 */
export async function saveChecks(api: APIRequestContext, assignmentId: string, changes: { stepId: string; checked: boolean; note?: string }[]) {
  const d = await (await api.get('/api/workspace/task-detail', { params: { id: assignmentId } })).json();
  return api.post('/api/workspace/task-detail', { data: { id: assignmentId, writeId: randomUUID(), version: d.workspace_version, changes } });
}
/** 刪掉 createTemplate 自動建立的那筆指派（只刪這個範本自己的 id），讓畫面測試只看到自己加的指派。 */
export async function dropAutoAssignments(t: { assignmentIds: string[] }) {
  const db = adminDb();
  if (!t.assignmentIds.length) return;
  for (const table of ['logs', 'assignment_collaborators']) {
    const d = await db.from(table).delete().in('assignment_id', t.assignmentIds);
    if (d.error) throw new Error(`清理 ${table} 失敗：${d.error.message}`);
  }
  const d = await db.from('assignments').delete().in('id', t.assignmentIds);
  if (d.error) throw new Error(`清理指派失敗：${d.error.message}`);
}
