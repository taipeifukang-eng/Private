import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { addAssignment, adminDb, auditRows, completeAssignment, countRows, createTemplate, deleteRunTemplates, m3Prefix, runIdOrThrow, setAssignment, templateExists, userId } from '../support/m3-fixtures';

// W07 對等層（M3 A.1、A.2、A.3、A.7）：同一種 fixture 準備兩份，舊版用畫面操作（server action deleteAssignment／deleteTemplate），
// 新版用 workspace API，之後用 service role 回讀殘留資料逐項比對。
// 與舊版不同且使用者已核可的差異登記在 tests/parity/allowlist.json（approvedBy "user (2026-11-07 survey/m3 …)"）：
//  - Q1 刪除模板底下還有待處理任務：舊版（資料庫有 cascade 時）直接連帶刪除，新版擋下；確認方式改為輸入標題。
//    注意：DEV 的外鍵 assignments_template_id_fkey 沒有 cascade，舊版 deleteTemplate 在 DEV 對「底下有指派的範本」一律失敗，
//    這個舊版限制登記為待核可（allowlist m3-legacy-delete-template-fk-*）。
//  - Q2 刪除任務／模板時新版寫稽核紀錄。
//  - Q3 模板列表全部顯示並標示尚未指派。
//  - A.7 模板詳情顯示範圍內全部未封存任務。

const map = loadMap('task-management');
const recorder = new ParityRecorder('task-management');
const find = (id: string) => map.entries.find((e) => e.id === id)!;

test.afterAll(async () => {
  await deleteRunTemplates();
});

/** 自動按「確定」，並把舊版跳出的訊息收集起來（失敗時能看出舊版回了什麼）。 */
function acceptDialogs(page: Page, messages: string[] = []) {
  page.on('dialog', (d) => {
    messages.push(d.message().replace(/\s+/g, ' ').slice(0, 300));
    void d.accept().catch(() => undefined);
  });
  return messages;
}
async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 30_000): Promise<T> {
  const t0 = Date.now();
  let v = await read();
  while (!done(v) && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 500));
    v = await read();
  }
  return v;
}

async function residue(templateId: string, assignmentIds: string[]) {
  return {
    templateDeleted: !(await templateExists(templateId)),
    assignmentsLeft: await countRows('assignments', 'id', assignmentIds),
    logsLeft: await countRows('logs', 'assignment_id', assignmentIds),
    collaboratorsLeft: await countRows('assignment_collaborators', 'assignment_id', assignmentIds),
    auditRows: (await auditRows({ template_id: templateId })).length,
  };
}

function record(id: string, title: string, mech: 'write-readback' | 'ui-extract', legacy: unknown, native: unknown, extra: Record<string, number | string> = {}) {
  const e = find(id);
  assertNoUnlistedDiffs(
    recorder.record({
      entry: id,
      mechanism: mech,
      role: 'admin',
      title,
      legacy: { endpoint: e.legacy.ui ? e.legacy.ui.route : `server action ${e.legacy.serverAction?.name}` },
      native: { endpoint: `${e.native.api?.method || 'GET'} ${e.native.api?.path}` },
      compared: { facts: Object.keys(legacy as object).length, ...extra },
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

test.describe.configure({ mode: 'serial' });

test('刪除已完成任務：舊版畫面「刪除」與新版 DELETE 的殘留一致（新版多一筆稽核紀錄，已核可）', async ({ browser }) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const admin = await apiAs('admin');
  const make = async (tag: string) => {
    const t = await createTemplate(admin, tag);
    const other = await addAssignment(t.id, { status: 'in_progress' }, [userId('employee')]);
    await completeAssignment(t.assignmentId, t.id, userId('admin'));
    return { ...t, other };
  };
  const L = await make('parity-del-assignment-L');
  const N = await make('parity-del-assignment-N');
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    acceptDialogs(page);
    await page.goto(`/admin/template/${L.id}`, { waitUntil: 'networkidle' });
    await page.locator('button[title="刪除已完成的任務"]').first().click();
    await until(() => countRows('assignments', 'id', [L.assignmentId]), (n) => n === 0);

    const res = await admin.delete('/api/workspace/task-management', { data: { kind: 'assignment', id: N.assignmentId } });
    expect(res.status()).toBe(200);

    const facts = async (x: typeof L) => ({
      assignmentGone: (await countRows('assignments', 'id', [x.assignmentId])) === 0,
      logsLeft: await countRows('logs', 'assignment_id', [x.assignmentId]),
      collaboratorsLeft: await countRows('assignment_collaborators', 'assignment_id', [x.assignmentId]),
      templateKept: await templateExists(x.id),
      otherAssignmentKept: (await countRows('assignments', 'id', [x.other])) === 1,
      auditRows: (await auditRows({ assignment_id: x.assignmentId })).length,
    });
    const legacy = await facts(L);
    const native = await facts(N);
    expect(legacy.assignmentGone, '舊版畫面刪除要成功（否則對等比較沒有意義）').toBe(true);
    record('delete-assignment', '刪除已完成任務', 'write-readback', legacy, native);
  } finally {
    await ctx.close();
    await admin.dispose();
  }
});

test('刪除流程模板（底下任務都已完成）：舊版卡片選單與新版 DELETE（輸入標題）的殘留一致', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await apiAs('admin');
  const make = async (tag: string) => {
    const t = await createTemplate(admin, tag);
    const second = await addAssignment(t.id, { status: 'pending' }, [userId('employee')]);
    await completeAssignment(t.assignmentId, t.id, userId('admin'));
    await completeAssignment(second, t.id, userId('employee'));
    return { ...t, ids: [t.assignmentId, second] };
  };
  const L = await make('parity-del-template-done-L');
  const N = await make('parity-del-template-done-N');
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    const said = acceptDialogs(page);
    await page.goto('/admin/templates', { waitUntil: 'networkidle' });
    const card = page.locator('div.shadow-lg', { has: page.locator('h3', { hasText: L.form.title }) }).first();
    await card.locator('button[title="更多選項"]').click();
    await card.getByRole('button', { name: '刪除整個流程模板' }).click();
    await until(() => templateExists(L.id), (exists) => !exists);
    test.info().annotations.push({ type: 'legacy-dialogs', description: said.join(' / ') });
    console.log('[W07 legacy deleteTemplate dialogs]', said.join(' / '));

    const res = await admin.delete('/api/workspace/task-management', { data: { kind: 'template', id: N.id, title: N.form.title } });
    expect(res.status(), JSON.stringify(await res.json())).toBe(200);

    const legacy = await residue(L.id, L.ids);
    const native = await residue(N.id, N.ids);
    record('delete-template-completed', '刪除流程模板（任務都已完成）', 'write-readback', legacy, native);
  } finally {
    await ctx.close();
    await admin.dispose();
  }
});

test('刪除流程模板（底下還有待處理任務）：新版擋下並不動資料；舊版在 DEV 也因外鍵刪不掉（正式區若有 cascade 才會連帶刪除，Q1 已核可）', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await apiAs('admin');
  const L = await createTemplate(admin, 'parity-del-template-active-L');
  const N = await createTemplate(admin, 'parity-del-template-active-N');
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    acceptDialogs(page);
    await page.goto('/admin/templates', { waitUntil: 'networkidle' });
    const card = page.locator('div.shadow-lg', { has: page.locator('h3', { hasText: L.form.title }) }).first();
    await card.locator('button[title="更多選項"]').click();
    await card.getByRole('button', { name: '刪除整個流程模板' }).click();
    await until(() => templateExists(L.id), (exists) => !exists, 20_000);

    const res = await admin.delete('/api/workspace/task-management', { data: { kind: 'template', id: N.id, title: N.form.title } });
    const legacy = { outcome: (await templateExists(L.id)) ? 'blocked' : 'deleted', ...(await residue(L.id, L.assignmentIds)) };
    const native = { outcome: res.status() === 409 ? 'blocked' : res.status() === 200 ? 'deleted' : `HTTP ${res.status()}`, ...(await residue(N.id, N.assignmentIds)) };
    expect(native.outcome).toBe('blocked');
    record('delete-template-active', '刪除流程模板（還有待處理任務）', 'write-readback', legacy, native);
  } finally {
    await ctx.close();
    await admin.dispose();
  }
});

test('模板列表：舊版只列有未封存任務的模板，新版全部列出並標示尚未指派（Q3 已核可的差異）', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await apiAs('admin');
  const fresh = await createTemplate(admin, 'parity-list-fresh');
  const idle = await createTemplate(admin, 'parity-list-idle');
  await setAssignment(idle.assignmentId, { archived: true, status: 'completed', archived_by: userId('admin'), archived_at: new Date().toISOString() });
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await page.goto('/admin/templates', { waitUntil: 'networkidle' });
    const legacyTitles = (await page.locator('div.shadow-lg h3').allInnerTexts()).map((t) => t.trim()).filter((t) => t.startsWith(m3Prefix())).sort();
    const nativeRows = ((await (await admin.get('/api/workspace/task-management')).json()).records as { title: string }[]).map((r) => r.title).filter((t) => t.startsWith(m3Prefix())).sort();
    const facts = (titles: string[]) => ({
      freshVisible: titles.includes(fresh.form.title),
      unassignedVisible: titles.includes(idle.form.title),
      visibleTitles: titles.join('|'),
    });
    expect(facts(legacyTitles).freshVisible, '舊版也要看得到有進行中任務的模板').toBe(true);
    record('list-templates', '模板列表可見性', 'ui-extract', facts(legacyTitles), facts(nativeRows), { legacyRows: legacyTitles.length, nativeRows: nativeRows.length });
  } finally {
    await ctx.close();
    await admin.dispose();
  }
});

test('模板詳情範圍：管理者沒參與的任務，舊版看不到，新版顯示範圍內全部未封存任務（A.7 已核可的差異）', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, 'parity-detail-scope');
  // 管理者（admin）不是協作者：把建立時自動加入的協作者列拿掉，換成一般員工
  const db = adminDb();
  const del = await db.from('assignment_collaborators').delete().eq('assignment_id', t.assignmentId).eq('user_id', userId('admin'));
  expect(del.error).toBeNull();
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await page.goto(`/admin/template/${t.id}`, { waitUntil: 'networkidle' });
    const legacyCount = await page.locator('a[href^="/assignment/"]').count();
    const body = await (await admin.get('/api/workspace/task-management', { params: { id: t.id } })).json();
    expect(await countRows('assignments', 'id', [t.assignmentId])).toBe(1);
    record('detail-scope', '模板詳情的任務範圍', 'ui-extract', { assignmentCount: legacyCount }, { assignmentCount: (body.records as unknown[]).length });
  } finally {
    await ctx.close();
    await admin.dispose();
  }
});
