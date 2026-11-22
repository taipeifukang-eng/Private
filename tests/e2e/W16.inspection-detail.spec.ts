import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { M4B_MONTH, deleteRunMasters, improvementsOf, patchImprovement, seedFollowupInspection } from '../support/m4b-fixtures';
import { adminDb, readMaster, runIdOrThrow } from '../support/m4-fixtures';
import { SIGNED } from '../support/png';
import { openInspectionDetail, openPrintPreview, work } from '../support/m4b-ui';

// W16 E2E（M4 Q20、Q21、Q22）：詳情分數並列、A4 列印報表（舊版版面＋改善回報結果＋系統期限日期）、刪除確認視窗列筆數與連帶刪除。
const DATE = `${M4B_MONTH.detail}-15`;
const DELETE_DATE = `${M4B_MONTH.detail}-16`;

let seeded: Awaited<ReturnType<typeof seedFollowupInspection>>;
test.beforeAll(async () => {
  runIdOrThrow();
  seeded = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: DATE, tag: 'w16-e2e', count: 3, deduction: 6, total: 200 });
  // 第一項店長已回報改善（觸發器算回補並加進總分）；第二項維持待改善
  await patchImprovement(seeded.improvements[0].id, {
    status: 'improved',
    improved_at: new Date().toISOString(),
    improvement_description: '已重新排列並加裝護欄（自動測試）',
    improvement_photo_urls: [SIGNED()],
  });
});
test.afterAll(async () => {
  await deleteRunMasters();
});

test('詳情：最終得分、原始得分、改善回補並列；列印報表照舊版版面並印出改善回報結果與系統期限', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openInspectionDetail(page, { month: M4B_MONTH.detail, store: 'ZT01', date: DATE });
    const master = await readMaster(seeded.id);
    const bonus = Number(master.improvement_bonus);
    expect(bonus).toBeGreaterThan(0);
    const score = work(page).getByTestId('detail-score');
    await expect(score).toContainText(`最終得分 ${Number(master.total_score)}`);
    await expect(work(page).getByTestId('score-original')).toHaveText(`原始得分 ${Math.round((Number(master.total_score) - bonus) * 10) / 10}`);
    await expect(work(page).getByTestId('score-bonus')).toContainText(`改善回補 +${bonus} 分`);

    await openPrintPreview(page);
    const report = work(page).getByTestId('print-report');
    // 舊版版面區塊
    for (const text of ['門市巡店檢核報告', '店鋪名稱：', '店鋪地址：', '報告編號：', '評分總覽', '得分率', '待改善項目彙整', '督導改善建議：', '回饋與簽名確認', '督導建議流程：', '本報告由系統自動生成', '列印時間：']) {
      await expect(report.getByText(text).first(), text).toBeVisible();
    }
    await expect(report.getByTestId('report-no')).toContainText(seeded.id.slice(0, 8).toUpperCase());
    // 三個待改善項目，每項一個手寫空格
    await expect(report.getByTestId('report-issue')).toHaveCount(3);
    await expect(report.getByTestId('handwriting-box')).toHaveCount(3);
    // Q20：已改善的那項多印回報結果與回補分數；沒改善的項目不出現
    const followup = report.getByTestId('report-followup');
    await expect(followup).toHaveCount(1);
    await expect(followup).toContainText('已重新排列並加裝護欄');
    await expect(followup).toContainText('回補');
    await expect(report.getByTestId('score-trio')).toContainText(`改善回補 +${bonus}`);
    // Q21：流程說明印系統期限日期與回補級距，不再寫死 3 個工作日
    const rows = await improvementsOf(seeded.id);
    const deadline = rows.map((r) => r.deadline).sort()[0];
    await expect(report.getByTestId('flow-deadline')).toHaveText(deadline);
    await expect(report.getByTestId('deadline-notice')).toContainText(`請於 ${deadline} 前回報`);
    await expect(report.getByTestId('deadline-notice')).toContainText('回補');
    await expect(report).not.toContainText('3 個工作日');
    // 簽名日期（沒有簽名時印底線）、督導未簽名時印姓名
    await expect(report.getByTestId('store-sign-date')).toContainText('簽名日期：_____________');
    await expect(report.getByTestId('inspector-name')).toHaveText('測試督導');

    // 列印按鈕會叫出瀏覽器列印
    await page.evaluate(() => {
      (window as any).__printCalls = 0;
      window.print = () => {
        (window as any).__printCalls += 1;
      };
    });
    await work(page).getByRole('button', { name: '列印報表' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(1);

    if (testInfo.project.name.startsWith('desktop')) {
      // A4 列印：列印媒體只剩報表、紙張 A4（595×842pt）
      await page.emulateMedia({ media: 'print' });
      const printed = await page.evaluate(() => ({
        visible: [...document.body.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.className),
      }));
      expect(printed.visible.join(' ')).toContain('inspection-print-output');
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const text = pdf.toString('latin1');
      const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
      expect(box, 'PDF 沒有 MediaBox').toBeTruthy();
      expect(Number(box![1])).toBeCloseTo(595.3, 0);
      expect(Number(box![2])).toBeCloseTo(841.9, 0);
      expect(((text.match(/\/Type\s*\/Page[^s]/g) || []).length), '至少兩頁（首頁＋待改善彙整另起一頁）').toBeGreaterThanOrEqual(2);
      fs.writeFileSync(testInfo.outputPath('w16-report.pdf'), pdf);
      await page.emulateMedia({ media: 'screen' });
    }
    await page.screenshot({ path: testInfo.outputPath(`w16-print-preview-${testInfo.project.name}.png`), fullPage: true });
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('刪除：確認視窗列出連帶刪除的筆數與回補分數會消失；取消不刪；確認後連同明細與改善回報一併刪除', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const target = await seedFollowupInspection({ store: 'ZT02', inspector: 'supervisor', date: DELETE_DATE, tag: 'w16-e2e-delete', count: 2, deduction: 5, total: 210 });
  await adminDb().from('inspection_on_duty_staff').insert({ inspection_id: target.id, employee_code: 'ZT-W16-9', employee_name: '[自動測試]丁', position: '店長', is_duty_supervisor: false });
  await patchImprovement(target.improvements[0].id, { status: 'improved', improved_at: new Date().toISOString(), improvement_description: '測試', improvement_photo_urls: [] });
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openInspectionDetail(page, { month: M4B_MONTH.detail, store: 'ZT02', date: DELETE_DATE });
    await work(page).getByRole('button', { name: '刪除巡店' }).click();
    const dialog = page.locator('dialog[open], [role=dialog]').last();
    await expect(dialog.getByTestId('delete-counts')).toContainText('2 筆檢查明細、1 筆當班人員及 2 筆改善回報');
    await expect(dialog.getByTestId('delete-bonus-warning')).toContainText('回補分數也會一併消失');
    await dialog.getByRole('button', { name: '取消刪除' }).click();
    expect((await readMaster(target.id)).id).toBe(target.id);
    await work(page).getByRole('button', { name: '刪除巡店' }).click();
    await page.locator('dialog[open], [role=dialog]').last().getByRole('button', { name: '確認刪除' }).click();
    await expect(work(page).getByText('巡店記錄已刪除，相關檢查明細、當班人員與改善回報已一併移除。')).toBeVisible();
    const left = await adminDb().from('inspection_masters').select('id', { count: 'exact', head: true }).eq('id', target.id);
    expect(left.count).toBe(0);
    const kids = await adminDb().from('inspection_improvements').select('id', { count: 'exact', head: true }).eq('inspection_id', target.id);
    expect(kids.count).toBe(0);
  } finally {
    await ctx.close();
  }
});
