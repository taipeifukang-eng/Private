import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { completeAssignment, createTemplate, deleteRunTemplates, runIdOrThrow, setAssignment, userId } from '../support/m3-fixtures';

// W09 對等層（M3 A.4、A.5）：
//  - 進入已封存任務頁：各角色在舊版（/admin/archived，profiles.role 為 admin 或 manager 才進得去，否則導回 /dashboard）與新版
//    （/api/workspace/task-archive：身分加 task.view_archived）能不能進。差異只有「主管但還沒有 task.view_archived」（ops_manager），
//    已核可（Q4），上線前以 docs/vue-workspace/parity-plan/m3-sql/ 補授權後消失。
//  - 封存任務詳情：舊版 /assignment/[id] 仍有可勾選的項目；新版唯讀（Q5，已核可）。

const map = loadMap('task-archive');
const recorder = new ParityRecorder('task-archive');
const find = (id: string) => map.entries.find((e) => e.id === id)!;

test.afterAll(async () => {
  await deleteRunTemplates();
});

const ROLES = ['admin', 'ops_manager', 'navigation', 'employee', 'denied'];

test('進入已封存任務頁：各角色在舊版與新版的結果', async ({ browser }) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const e = find('archive-access');
  for (const role of ROLES) {
    const ctx = await loginAs(browser, role);
    const api = await apiAs(role);
    try {
      const page = await ctx.newPage();
      await page.goto('/admin/archived', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const legacy = { canEnter: new URL(page.url()).pathname.startsWith('/admin/archived') };
      const native = { canEnter: (await api.get('/api/workspace/task-archive')).status() === 200 };
      assertNoUnlistedDiffs(
        recorder.record({
          entry: 'archive-access',
          mechanism: 'write-readback',
          role,
          title: '進入已封存任務頁',
          legacy: { endpoint: '/admin/archived（最終網址）' },
          native: { endpoint: `GET ${e.native.api?.path}` },
          compared: { canEnter: legacy.canEnter },
          diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
        }),
      );
    } finally {
      await ctx.close();
      await api.dispose();
    }
  }
});

test('封存任務詳情：舊版仍可勾選，新版唯讀（Q5 已核可的差異）', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await apiAs('admin');
  const t = await createTemplate(admin, 'parity-archive-readonly');
  await completeAssignment(t.assignmentId, t.id, userId('admin'));
  await setAssignment(t.assignmentId, { archived: true, archived_by: userId('admin'), archived_at: new Date().toISOString() });
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await page.goto(`/assignment/${t.assignmentId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // 舊版 ChecklistRunner 的勾選是圖示按鈕（button.flex-shrink-0），每個項目一顆
    const legacyCheckboxes = await page.locator('button.flex-shrink-0').count();
    const legacy = { interactive: legacyCheckboxes > 0 };
    const res = await admin.get('/api/workspace/task-detail', { params: { id: t.assignmentId } });
    const native = { interactive: res.status() === 200 };
    expect(res.status(), '新版封存任務不能開啟執行頁').toBe(404);
    assertNoUnlistedDiffs(
      recorder.record({
        entry: 'archive-readonly',
        mechanism: 'write-readback',
        role: 'admin',
        title: '封存任務是否還能勾選',
        legacy: { endpoint: '/assignment/[id]（可點選的勾選按鈕數）', status: legacyCheckboxes },
        native: { endpoint: 'GET /api/workspace/task-detail', status: res.status() },
        compared: { interactive: legacy.interactive },
        diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
      }),
    );
  } finally {
    await ctx.close();
    await admin.dispose();
  }
});
