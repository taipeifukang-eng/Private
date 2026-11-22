import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { adminDb, DEPT, deleteRunTemplates, m3Title, runIdOrThrow, saveTemplate, userId } from '../support/m3-fixtures';

// P03 對等層（M3 A.7）：建立任務的寫入對等。
// 同一份輸入（標題、說明、營業部區段、同一位執行人員、一個必填主項），舊版用 /admin/create 畫面（server action createTemplateV2），
// 新版用 POST /api/workspace/task-template；用 service role 回讀範本、指派、協作者，逐欄比對。
// 舊版畫面在 DEV 只有營業部主管（ops_manager）看得到營業部人員名單（profiles RLS），但該帳號寫不進 templates（RLS）：
// 所以用 ops_manager 操作畫面、攔下送出的 server action 請求，改以管理員的登入狀態重送（實際執行舊版 createTemplateV2），新版同樣以管理員操作。
// 兩邊建立者都是管理員（比對時換成 ACTOR）；隨機 id、時間戳、版本號、標題尾碼不比；新版區段多出的 support_users（跨部門支援，M3 A.6）與舊版不同的部分已登記在 allowlist。

const map = loadMap('task-create');
const recorder = new ParityRecorder('task-create');

test.afterAll(async () => {
  await deleteRunTemplates();
});

/** actorId 換成 'ACTOR'：舊版以營業部主管（唯一在 DEV 看得到營業部人員名單的帳號）操作，新版以管理員操作，建立者不同但規則相同。 */
async function facts(title: string, actorId: string, actorDepartment: string | null) {
  const who = (id: string | null) => (id === actorId ? 'ACTOR' : id);
  const db = adminDb();
  const t = await db.from('templates').select('*').eq('title', title).single();
  if (t.error) throw new Error(`讀不到範本 ${title}：${t.error.message}`);
  const a = await db.from('assignments').select('*').eq('template_id', t.data.id);
  const c = await db.from('assignment_collaborators').select('user_id,section_id').in('assignment_id', (a.data as { id: string }[]).map((x) => x.id));
  const sections = (t.data.sections as any[]).map((s) => ({
    department: s.department,
    assigned_users: s.assigned_users.map(who).sort(),
    steps: (s.steps as any[]).map((st) => ({ label: st.label, description: st.description || '', required: !!st.required })),
  }));
  const sectionIdToIndex = new Map((t.data.sections as any[]).map((s, i) => [s.id, i]));
  return {
    template: {
      description: t.data.description || '',
      created_by: who(t.data.created_by),
      sections,
      steps_schema: (t.data.steps_schema as any[]).map((st) => ({ label: st.label, description: st.description || '', required: !!st.required })),
    },
    assignments: (a.data as any[]).map((x) => ({
      status: x.status,
      archived: !!x.archived,
      departmentIsCreatorsDepartment: (x.department ?? null) === (actorDepartment ?? null),
      assigned_to: who(x.assigned_to),
      created_by: who(x.created_by),
      planned_start_date: x.planned_start_date,
      planned_end_date: x.planned_end_date,
    })),
    collaborators: (c.data as any[]).map((x) => ({ user_id: who(x.user_id), sectionIndex: x.section_id ? (sectionIdToIndex.get(x.section_id) ?? 'unknown') : null })).sort((p, q) => String(p.user_id).localeCompare(String(q.user_id))),
  };
}

test('建立任務：舊版畫面與新版 API 寫入的範本、指派、協作者一致', async ({ browser }) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const db = adminDb();
  const opsName = (await db.from('profiles').select('full_name').eq('id', userId('ops_assistant')).single()).data.full_name as string;
  const titleL = m3Title('parity-create-L');
  const titleN = m3Title('parity-create-N');
  const admin = await apiAs('admin');
  const ctx = await loginAs(browser, 'ops_manager');
  try {
    // 舊版：畫面操作
    const page = await ctx.newPage();
    const said: string[] = [];
    page.on('dialog', (d) => {
      said.push(d.message().replace(/\s+/g, ' ').slice(0, 200));
      void d.accept().catch(() => undefined);
    });
    await page.goto('/admin/create', { waitUntil: 'networkidle' });
    await page.getByPlaceholder('輸入專案標題').fill(titleL);
    await page.getByPlaceholder('輸入專案描述（選填）').fill('自動測試範本');
    await page.getByRole('button', { name: '新增第一個部門區塊' }).click();
    await page.locator('select').filter({ hasText: '請選擇部門' }).selectOption(DEPT);
    await page.locator('label', { hasText: opsName }).locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: '新增步驟' }).first().click();
    await page.getByPlaceholder('步驟名稱 *').first().fill('步驟一');
    // 儲存：營業部主管的 RLS 不允許寫入 templates（DEV），所以只攔下畫面送出的 server action 請求（含 Next-Action 編號與參數），
    // 改用管理員的登入狀態重送同一個請求，實際執行的就是舊版 createTemplateV2。
    const captured = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action'], { timeout: 30_000 });
    await page.getByRole('button', { name: '儲存任務' }).click();
    const req = await captured;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers())) if (!['cookie', 'host', 'content-length', 'connection', 'origin', 'referer'].includes(k.toLowerCase())) headers[k] = v;
    const replay = await admin.post('/admin/create', { headers: { ...headers, Origin: 'http://localhost:3002' }, data: req.postData() || '' });
    expect(replay.status(), '重送舊版 server action').toBeLessThan(400);
    const t0 = Date.now();
    let saved = false;
    while (Date.now() - t0 < 30_000 && !saved) {
      saved = ((await db.from('templates').select('id').eq('title', titleL)).data || []).length > 0;
      if (!saved) await new Promise((r) => setTimeout(r, 500));
    }
    expect(saved, `舊版建立失敗：${said.join(' / ')}；${(await replay.text()).slice(0, 300)}`).toBe(true);

    // 新版：API（同一份輸入）
    const stepId = randomUUID();
    const { res, json } = await saveTemplate(admin, {
      title: titleN,
      description: '自動測試範本',
      planned_start_date: '',
      planned_end_date: '',
      sections: [{ id: randomUUID(), department: DEPT, assigned_users: [userId('ops_assistant')], steps: [{ id: stepId, label: '步驟一', description: '', required: false, planned_start_date: '', planned_end_date: '', subSteps: [] }] }],
    } as any);
    expect(res.status(), JSON.stringify(json)).toBe(200);

    const dept = async (key: string) => ((await db.from('profiles').select('department').eq('id', userId(key)).single()).data.department as string | null) ?? null;
    const legacy = await facts(titleL, userId('admin'), await dept('admin'));
    const native = await facts(titleN, userId('admin'), await dept('admin'));
    assertNoUnlistedDiffs(
      recorder.record({
        entry: 'create-result',
        mechanism: 'write-readback',
        role: 'admin',
        title: '建立任務的寫入結果',
        legacy: { endpoint: '/admin/create → createTemplateV2' },
        native: { endpoint: 'POST /api/workspace/task-template' },
        compared: { assignments: legacy.assignments.length, collaborators: legacy.collaborators.length, sections: legacy.template.sections.length },
        diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
      }),
    );
    expect(map.entries.map((e) => e.id)).toContain('create-result');
  } finally {
    await ctx.close();
    await admin.dispose();
  }
});
