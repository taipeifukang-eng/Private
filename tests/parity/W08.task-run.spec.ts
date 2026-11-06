import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import {
  addSectionAssignment,
  adminDb,
  assignmentRow,
  createTemplate,
  deleteRunTemplates,
  dropAutoAssignments,
  logRows,
  logSteps,
  runIdOrThrow,
  saveChecks,
  templateSections,
  twoSections,
  userId,
} from '../support/m3-fixtures';

// W08 / W10 對等層（M3 B.1–B.4）：同一種 fixture 準備兩份，舊版用畫面操作與畫面擷取，新版用 workspace API，逐項比對。
// 與舊版不同且使用者已核可的差異登記在 tests/parity/allowlist.json（approvedBy "user (2026-11-07 survey/m3 …)"）：
//  - Q7 非參與者打開任務（只有任務管理權限者，舊版 admin/manager 都可）。 Q8 去重保留有進度者。
//  - Q9 所有區段完成才算已完成。 Q10 儀表板進度與狀態以整體勾選進度為準。

const map = loadMap('task-run');
const recorder = new ParityRecorder('task-run');
const find = (id: string) => map.entries.find((e) => e.id === id)!;

test.afterAll(async () => {
  await deleteRunTemplates();
});

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = 30_000): Promise<T> {
  const t0 = Date.now();
  let v = await read();
  while (!done(v) && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 500));
    v = await read();
  }
  return v;
}

function record(id: string, title: string, role: string, mech: 'write-readback' | 'ui-extract' | 'api-read', legacy: object, native: object) {
  const e = find(id);
  assertNoUnlistedDiffs(
    recorder.record({
      entry: id,
      mechanism: mech,
      role,
      title,
      legacy: { endpoint: e.legacy.ui ? e.legacy.ui.route : 'legacy' },
      native: { endpoint: `${e.native.api?.method || 'GET'} ${e.native.api?.path}` },
      compared: { facts: Object.keys(legacy).length },
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

test.describe.configure({ mode: 'serial' });

test('已完成的判定：自己的區段做完，舊版算已完成，新版仍是進行中（Q9 已核可的差異）', async ({ browser }) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const admin = await apiAs('admin');
  const ops = await apiAs('ops_assistant');
  const make = async (tag: string) => {
    const t = await createTemplate(admin, tag, twoSections());
    const [secA, secB] = await templateSections(t.id);
    await dropAutoAssignments(t);
    const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
    const c = await adminDb().from('assignment_collaborators').insert({ assignment_id: a, user_id: userId('ga_staff'), section_id: secB.id });
    if (c.error) throw new Error(c.error.message);
    return { ...t, a, secA };
  };
  const L = await make('parity-complete-L');
  const N = await make('parity-complete-N');
  const ctx = await loginAs(browser, 'ops_assistant');
  try {
    const page = await ctx.newPage();
    await page.goto(`/assignment/${L.a}`, { waitUntil: 'networkidle' });
    const boxes = page.locator('button.flex-shrink-0');
    const n = await boxes.count();
    expect(n, '舊版執行頁要看得到自己區段的勾選按鈕').toBeGreaterThanOrEqual(2);
    // 舊版：點圓圈 → 出現備註欄 → 按「完成此步驟」；寫入中不接受連點，所以每步等紀錄出現再做下一步
    for (let i = 0; i < n; i++) {
      for (let attempt = 0; attempt < 4; attempt++) {
        await page.waitForTimeout(1200); // 舊版寫入中（isProcessing）會忽略點擊，等它放開
        await boxes.nth(i).click();
        await page.getByRole('button', { name: '完成此步驟' }).click();
        const rows = await until(() => logRows(L.a), (r) => r.length >= i + 1, 4_000);
        if (rows.length >= i + 1) break;
      }
    }
    await until(() => assignmentRow(L.a), (r) => r.status === 'completed', 25_000);

    const res = await saveChecks(ops, N.a, N.secA.steps.map((s) => ({ stepId: s.id, checked: true })));
    expect(res.status(), JSON.stringify(await res.json().catch(() => ({})))).toBe(200);

    const facts = async (x: typeof L) => ({
      statusAfterOwnSectionDone: (await assignmentRow(x.a)).status,
      logsWritten: (await logRows(x.a)).length,
      proxyLogs: (await logRows(x.a)).filter((r) => r.proxy).length,
    });
    record('run-completion-rule', '自己區段做完後的任務狀態', 'ops_assistant', 'write-readback', await facts(L), await facts(N));
  } finally {
    await ctx.close();
    await admin.dispose();
    await ops.dispose();
  }
});

test('我的任務去重：舊版只留最新一筆，新版保留有進度的、收起沒動過的（Q8 已核可的差異）', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = await apiAs('admin');
  const ops = await apiAs('ops_assistant');
  const opsId = userId('ops_assistant');
  const make = async (tag: string) => {
    const t = await createTemplate(admin, tag, twoSections());
    const [secA] = await templateSections(t.id);
    await dropAutoAssignments(t);
    const one = await addSectionAssignment(t.id, secA.id, [opsId]);
    await logSteps(one, [secA.steps[0].id], opsId);
    const two = await addSectionAssignment(t.id, secA.id, [opsId]);
    await logSteps(two, [secA.steps[1].id], opsId);
    const idle = await addSectionAssignment(t.id, secA.id, [opsId]);
    return { ...t, ids: [one, two, idle] };
  };
  const L = await make('parity-dedupe-L');
  const N = await make('parity-dedupe-N');
  const ctx = await loginAs(browser, 'ops_assistant');
  try {
    const page = await ctx.newPage();
    await page.goto('/my-tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const hrefs = await page.locator('a[href^="/assignment/"]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') || ''));
    const legacyShown = hrefs.map((h) => h.replace('/assignment/', '')).filter((id) => L.ids.includes(id));

    const rows = ((await (await ops.get('/api/workspace/tasks')).json()).records as { id: string; overallDone: number }[]).filter((r) => N.ids.includes(r.id));
    const summarize = (shown: string[], ids: string[], progressed: string[]) => ({
      visibleCards: shown.length,
      everyProgressedCardVisible: progressed.every((id) => shown.includes(id)),
      idleDuplicateVisible: shown.includes(ids[2]),
    });
    const legacy = summarize(legacyShown, L.ids, L.ids.slice(0, 2));
    const native = summarize(rows.map((r) => r.id), N.ids, N.ids.slice(0, 2));
    record('my-tasks-dedupe', '同範本同區段多筆指派的卡片', 'ops_assistant', 'ui-extract', legacy, native);
  } finally {
    await ctx.close();
    await admin.dispose();
    await ops.dispose();
  }
});

test('儀表板進度與狀態：舊版只算自己的區段，新版算整體（Q10 已核可的差異）', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = await apiAs('admin');
  const ops = await apiAs('ops_assistant');
  const opsId = userId('ops_assistant');
  const make = async (tag: string) => {
    const t = await createTemplate(admin, tag, twoSections());
    const [secA] = await templateSections(t.id);
    await dropAutoAssignments(t);
    const a = await addSectionAssignment(t.id, secA.id, [opsId]);
    await logSteps(a, secA.steps.map((s) => s.id), opsId);
    return { ...t, a };
  };
  const L = await make('parity-dashboard-L');
  const N = await make('parity-dashboard-N');
  const ctx = await loginAs(browser, 'ops_assistant');
  try {
    const page = await ctx.newPage();
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    const row = page.locator('tbody tr', { hasText: L.form.title }).first();
    await row.waitFor({ timeout: 20_000 });
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    const legacy = {
      progressPercent: Number(/(\d+)%/.exec(text)?.[1] ?? NaN),
      statusLabel: /(已完成|進行中|待處理)/.exec(text)?.[1] || '',
    };
    const d = await (await ops.get('/api/workspace/dashboard')).json();
    const rec = (d.records as any[]).find((r) => r.id === N.a);
    const label: Record<string, string> = { completed: '已完成', in_progress: '進行中', pending: '待處理' };
    const native = { progressPercent: rec.percent as number, statusLabel: label[rec.status] };
    record('dashboard-progress', '儀表板單筆任務的進度與狀態', 'ops_assistant', 'ui-extract', legacy, native);
  } finally {
    await ctx.close();
    await admin.dispose();
    await ops.dispose();
  }
});

test('打開非自己參與的任務：管理員新舊都可；營業主管舊版可、新版需任務管理權限（Q7、D08 已核可的差異）', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, 'parity-open-others', twoSections());
  const [secA] = await templateSections(t.id);
  const a = await addSectionAssignment(t.id, secA.id, [userId('ops_assistant')]);
  try {
    for (const role of ['admin', 'ops_manager']) {
      const ctx = await loginAs(browser, role);
      const api = await apiAs(role);
      try {
        const page = await ctx.newPage();
        await page.goto(`/assignment/${a}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);
        const denied = await page.getByText(/無權訪問|任務不存在/).count();
        const legacy = { canOpen: denied === 0 };
        const native = { canOpen: (await api.get('/api/workspace/task-detail', { params: { id: a } })).status() === 200 };
        record('open-others-task', `非參與者打開任務（${role}）`, role, 'api-read', legacy, native);
      } finally {
        await ctx.close();
        await api.dispose();
      }
    }
  } finally {
    await admin.dispose();
  }
});
