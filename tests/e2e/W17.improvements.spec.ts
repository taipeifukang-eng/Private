import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { M4B_MONTH, bonusRulesDb, deleteRunMasters, patchImprovement, readImprovement, seedFollowupInspection } from '../support/m4b-fixtures';
import { runIdOrThrow } from '../support/m4-fixtures';
import { makePng } from '../support/png';
import { improvementRows, openImprovements, work } from '../support/m4b-ui';
import { addDays, improvementToday } from '../../lib/workspace/improvement-rules';

// W17 E2E（M4 Q18、Q19、急迫標示與連結）：列表標示、店長回報（含照片）、逾期補報回補 0、只有查看權限者看不到填寫區。
const D = (day: number) => `${M4B_MONTH.followup}-${String(day).padStart(2, '0')}`;
const today = improvementToday();

let list: Awaited<ReturnType<typeof seedFollowupInspection>>; // 4 項：急迫、一般、逾期（pending 過期限）、逾期（DB overdue）
let report: Awaited<ReturnType<typeof seedFollowupInspection>>;
let photoRec: Awaited<ReturnType<typeof seedFollowupInspection>>;
test.beforeAll(async () => {
  runIdOrThrow();
  list = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: D(20), tag: 'w17-e2e-list', count: 4, deduction: 6 });
  await patchImprovement(list.improvements[0].id, { deadline: addDays(today, 1) });
  await patchImprovement(list.improvements[1].id, { deadline: addDays(today, 6) });
  await patchImprovement(list.improvements[2].id, { deadline: addDays(today, -2) });
  await patchImprovement(list.improvements[3].id, { deadline: addDays(today, -9), status: 'overdue' });
  report = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: D(21), tag: 'w17-e2e-report', count: 2, deduction: 8 });
  await patchImprovement(report.improvements[1].id, { deadline: addDays(today, -4) });
  photoRec = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: D(22), tag: 'w17-e2e-photo', count: 1, deduction: 5 });
  await patchImprovement(photoRec.improvements[0].id, { deadline: addDays(today, 5) });
});
test.afterAll(async () => {
  await deleteRunMasters();
});

const rowFor = (page: Page, i: number) => improvementRows(page, { date: D(20), store: 'ZT01' }).filter({ hasText: list.templates[i].item_name });

test('列表：剩 2 天內標急迫、顯示剩餘天數、逾期標紅；篩選已逾期；連到完整巡店記錄', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openImprovements(page);
    await work(page).getByLabel('改善狀態').selectOption('all');
    const urgent = rowFor(page, 0);
    await expect(urgent).toHaveAttribute('data-urgent', 'true');
    await expect(urgent.getByTestId('urgent-badge')).toBeVisible();
    await expect(urgent.getByTestId('remaining')).toHaveText('剩 1 天');
    const normal = rowFor(page, 1);
    await expect(normal).toHaveAttribute('data-urgent', 'false');
    await expect(normal.getByTestId('urgent-badge')).toHaveCount(0);
    await expect(normal.getByTestId('remaining')).toHaveText('剩 6 天');
    const late = rowFor(page, 2);
    await expect(late).toHaveAttribute('data-status', 'overdue');
    await expect(late.getByTestId('remaining')).toHaveText('逾期 2 天');
    await expect(rowFor(page, 3)).toHaveAttribute('data-status', 'overdue');
    // 篩選「已逾期」：兩種逾期（pending 過期限、資料庫標的 overdue）都在
    await work(page).getByLabel('改善狀態').selectOption('overdue');
    await expect(rowFor(page, 2)).toBeVisible();
    await expect(rowFor(page, 3)).toBeVisible();
    await expect(rowFor(page, 0)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`w17-list-${testInfo.project.name}.png`), fullPage: true });
    // 查看完整巡店記錄
    await rowFor(page, 2).getByTestId('open-inspection').click();
    await expect(work(page).getByRole('heading', { name: '巡店紀錄明細' })).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('店長回報：填說明、上傳照片、確認提交，回補按規則算並顯示；已改善後不能再改', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'store_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openImprovements(page);
    const row = improvementRows(page, { date: D(21), store: 'ZT01' }).filter({ hasText: report.templates[0].item_name });
    await row.getByRole('button', { name: '查看與回報' }).click();
    await expect(work(page).getByRole('heading', { name: '改善項目與回報' })).toBeVisible();
    await expect(work(page).getByTestId('estimate-note')).toContainText('預估回補扣分');
    await work(page).getByLabel('改善說明').fill('已整理陳列並補貨，現場恢復整齊（自動測試）');
    await work(page).getByLabel('上傳改善照片').setInputFiles({ name: 'fix.png', mimeType: 'image/png', buffer: makePng({ width: 640, height: 480, inkPixels: 80 }) });
    await expect(work(page).getByAltText('改善照片 1')).toBeVisible();
    await work(page).getByRole('button', { name: '提交改善回報' }).click();
    await page.locator('dialog[open], [role=dialog]').last().getByRole('button', { name: '確認提交' }).click();
    const saved = await (async () => {
      await expect(work(page).getByText(/改善內容已送出，回補 [\d.]+ 分。/)).toBeVisible();
      return readImprovement(report.improvements[0].id);
    })();
    expect(saved.status).toBe('improved');
    expect(saved.improvement_photo_urls).toHaveLength(1);
    const rules = await bonusRulesDb();
    expect(rules.length).toBeGreaterThan(0);
    await expect(work(page).getByText(`改善內容已送出，回補 ${Number(saved.bonus_score)} 分。`)).toBeVisible();
    // 已改善：填寫區消失，顯示改善結果
    await expect(work(page).getByLabel('改善說明')).toHaveCount(0);
    await expect(work(page).getByRole('heading', { name: '改善結果' })).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('改善照片：中文「選擇照片」按鈕（原生 input 隱藏）、可多選、縮圖可刪除、最多 5 張，不改變提交內容', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'store_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openImprovements(page);
    const row = improvementRows(page, { date: D(22), store: 'ZT01' });
    await row.getByRole('button', { name: '查看與回報' }).first().click();
    await expect(work(page).getByRole('heading', { name: '改善項目與回報' })).toBeVisible();
    // 中文按鈕可見；原生 input 隱藏（不會出現瀏覽器英文 Choose Files），且沒有 capture（從相簿／檔案挑選）
    const btn = work(page).locator('.photo-capture-button');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('選擇照片');
    const input = work(page).getByTestId('improvement-photo-input');
    await expect(input).toHaveAttribute('multiple', '');
    expect(await input.getAttribute('capture')).toBeNull();
    const hidden = await input.evaluate((el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return { opacity: cs.opacity, position: cs.position, events: cs.pointerEvents, inside: !!el.closest('.photo-capture-button') };
    });
    expect(hidden.opacity, '原生 input 透明').toBe('0');
    expect(hidden.position).toBe('absolute');
    expect(hidden.events).toBe('none');
    expect(hidden.inside, '原生 input 包在中文按鈕裡').toBe(true);
    // 一次多選 3 張
    await input.setInputFiles([1, 2, 3].map((n) => ({ name: `m${n}.png`, mimeType: 'image/png', buffer: makePng({ width: 640, height: 480, inkPixels: 70 + n }) })));
    const thumbs = work(page).locator('.photo-thumb');
    await expect(thumbs).toHaveCount(3);
    // 刪除第 2 張
    await work(page).getByRole('button', { name: '刪除改善照片 2' }).click();
    await expect(thumbs).toHaveCount(2);
    // 補到上限 5 張：再一次選 4 張，只收 3 張並提示
    await input.setInputFiles([4, 5, 6, 7].map((n) => ({ name: `m${n}.png`, mimeType: 'image/png', buffer: makePng({ width: 640, height: 480, inkPixels: 70 + n }) })));
    await expect(thumbs).toHaveCount(5);
    await expect(work(page).getByText('最多可上傳 5 張照片')).toBeVisible();
    await expect(btn).toHaveCount(0);
    await expect(work(page).getByText('已達上傳上限（5張）')).toBeVisible();
    // 不是圖片格式：不收
    await work(page).getByRole('button', { name: '刪除改善照片 5' }).click();
    await input.setInputFiles({ name: 'x.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(work(page).getByText('請選擇 JPEG、PNG 或 WebP 圖片')).toBeVisible();
    await expect(thumbs).toHaveCount(4);
    // 再選一張合法照片：成功加入後，上一次的紅字錯誤要消失
    await input.setInputFiles({ name: 'ok.png', mimeType: 'image/png', buffer: makePng({ width: 640, height: 480, inkPixels: 99 }) });
    await expect(thumbs).toHaveCount(5);
    await expect(work(page).getByText('請選擇 JPEG、PNG 或 WebP 圖片')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`w17-photo-upload-${testInfo.project.name}.png`), fullPage: true });
  } finally {
    await ctx.close();
  }
});

test('逾期補報：顯示「仍可補報、回補 0 分」，送出後記錄改善但不加分', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'store_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openImprovements(page);
    await work(page).getByLabel('改善狀態').selectOption('overdue');
    const row = improvementRows(page, { date: D(21), store: 'ZT01' }).filter({ hasText: report.templates[1].item_name });
    await row.getByRole('button', { name: '查看與回報' }).click();
    await expect(work(page).getByTestId('overdue-note')).toContainText('回補 0 分');
    await work(page).getByLabel('改善說明').fill('逾期補報：已完成改善（自動測試）');
    await work(page).getByLabel('上傳改善照片').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: makePng({ width: 640, height: 480, inkPixels: 90 }) });
    await work(page).getByRole('button', { name: '提交改善回報' }).click();
    await page.locator('dialog[open], [role=dialog]').last().getByRole('button', { name: '確認提交' }).click();
    await expect(work(page).getByText('改善內容已送出，回補 0 分。')).toBeVisible();
    const saved = await readImprovement(report.improvements[1].id);
    expect(saved.status).toBe('improved');
    expect(Number(saved.bonus_score)).toBe(0);
  } finally {
    await ctx.close();
  }
});

test('只有查看權限者（navigation）：看得到項目與連結，但沒有填寫區', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'navigation');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openImprovements(page);
    await work(page).getByLabel('改善狀態').selectOption('all');
    await rowFor(page, 0).getByRole('button', { name: '查看與回報' }).click();
    await expect(work(page).getByRole('heading', { name: '改善項目與回報' })).toBeVisible();
    await expect(work(page).getByTestId('no-submit-note')).toContainText('提交改善');
    await expect(work(page).getByLabel('改善說明')).toHaveCount(0);
    await expect(work(page).getByTestId('open-inspection')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
