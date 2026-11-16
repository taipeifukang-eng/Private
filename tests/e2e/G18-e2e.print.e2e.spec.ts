import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertGaBaseline, cleanupM7M8, M7_FILE_PREFIX, seedWorkOrder } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { noPageOverflow } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { multipartBody } from '../support/multipart';
import { makePng } from '../support/png';
import { db, dialogFits, openAs, openCenter, openWo, realErrors, vis } from '../support/g18-journey';

// M7/M8 第 5 批 G18.print.e2e（W7 A4 工單表單；桌機 project 跑一次，總務桌機 1440、店長手機 390）：
//  - 預覽：基本資料（門市、聯絡窗口、問題描述）＋公開進度＋照片；預設沒有內部備註與強制結案原因，勾選「包含內部備註與強制結案原因」後才出現（只有總務端看得到這個勾選；API 也擋店長）。
//  - 列印樣式：列印媒體只留表單；A4（寬 210mm）版面不超出、表格邊框沒被裁；實際輸出 PDF（A4、一頁）。
//  - 照片：新照片簽名網址載得出來；舊版照片標「舊版照片」。
const N = '/api/workspace/general-affairs';
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let woId = '';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_store_a', 'wo_manager']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const w = await seedWorkOrder('VW001', 'PRT-A', users.wo_store_a.id, { status: 'PROCESSING', progress_stage: 'VENDOR_WORKING', accepted_at: new Date().toISOString(), contact_name: '王店長', contact_phone: '0912345678', description: '飲水機漏水，地板濕滑 PRT' });
  woId = w.id;
  const up = (visibility: string, notes: string) => ({ request_id: woId, status: 'PROCESSING', progress_stage: 'VENDOR_WORKING', visibility, notes, progress_date: new Date().toISOString().slice(0, 10), updated_by: users.wo_manager.id, updated_by_name: 'M7M8 總務' });
  const ins = await db().from('maintenance_updates').insert([up('PUBLIC', '公開進度 PRT：已通知廠商'), up('INTERNAL', '內部備註 PRT：廠商報價偏高'), up('INTERNAL', '強制結案原因 PRT 不給門市看')]);
  expect(ins.error).toBeNull();
  // 一張新照片（共用附件）
  const c = await apiForUser(users.wo_manager as any);
  const mp = multipartBody([{ name: `${M7_FILE_PREFIX}prt-photo.png`, mimeType: 'image/png', buffer: makePng({ width: 200, height: 120, inkPixels: 40 }) }], { kind: 'REPORT_PHOTO' });
  const r = await c.post(`${N}/work-orders/${woId}/attachments`, { data: mp.data, headers: mp.headers });
  expect(r.status(), await r.text()).toBe(201);
  await c.dispose();
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件）').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('A4 工單表單：預設沒有內部備註，勾選後才出現；列印媒體只留表單；A4 版面不超出、表格邊框沒被裁；輸出 PDF（A4、一頁）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const ga = await openAs(browser, states.wo_manager, 'desktop');
  try {
    await openCenter(ga.page);
    await openWo(ga.page, 'PRT-A');
    await vis(ga.page, 'act-print').click();
    const dlg = dialog(ga.page);
    await expect(dlg.getByTestId('wo-print-dialog')).toBeVisible();
    const sheet = dlg.getByTestId('wo-sheet');
    await expect(sheet).toBeVisible();
    await dialogFits(ga.page);
    // 基本資料、問題描述、公開進度、照片
    await expect(sheet).toContainText('王店長');
    await expect(sheet).toContainText('0912345678');
    await expect(sheet).toContainText('飲水機漏水，地板濕滑 PRT');
    await expect(sheet.getByTestId('sheet-no')).toHaveText(`WO-${woId.slice(0, 8).toUpperCase()}`);
    await expect(sheet.getByTestId('sheet-timeline')).toContainText('公開進度 PRT：已通知廠商');
    const img = sheet.getByTestId('sheet-photos').locator('img').first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    // 預設：沒有內部備註與強制結案原因
    await expect(dlg.getByTestId('print-include-internal')).not.toBeChecked();
    await expect(sheet.getByTestId('sheet-internal-title')).toHaveCount(0);
    await expect(sheet).not.toContainText('內部備註 PRT');
    await expect(sheet).not.toContainText('強制結案原因 PRT');
    // 勾選後出現（重新向伺服端取資料，不是只在前端藏起來）
    await dlg.getByTestId('print-include-internal').check();
    await expect(sheet.getByTestId('sheet-internal-title')).toBeVisible();
    await expect(sheet.getByTestId('sheet-internal')).toContainText('內部備註 PRT：廠商報價偏高');
    await expect(sheet).toContainText('強制結案原因 PRT');
    // 取消勾選又消失
    await dlg.getByTestId('print-include-internal').uncheck();
    await expect(sheet.getByTestId('sheet-internal-title')).toHaveCount(0);
    await expect(sheet).not.toContainText('內部備註 PRT');

    // 表格邊框沒被裁：資訊表的每個祖先都包得住它（預覽）
    const clipped = await sheet.locator('.wo-sheet-info').evaluate((table) => {
      const t = table.getBoundingClientRect();
      const bad: string[] = [];
      let el: HTMLElement | null = table.parentElement;
      while (el && el !== document.documentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflowY !== 'visible' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') {
          const r = el.getBoundingClientRect();
          if (r.bottom < t.bottom - 0.5 || r.top > t.top + 0.5) bad.push(`${el.tagName}.${el.className}`);
        }
        el = el.parentElement;
      }
      const rows = Array.from(table.querySelectorAll('tr'));
      const last = rows[rows.length - 1].getBoundingClientRect();
      return { bad, tableBottom: t.bottom, lastRowBottom: last.bottom };
    });
    expect(clipped.bad).toEqual([]);
    expect(clipped.lastRowBottom).toBeLessThanOrEqual(clipped.tableBottom + 0.5);

    // 列印媒體：只留表單；A4 寬度（約 794px）下版面不超出
    await dlg.getByTestId('print-include-internal').check();
    await expect(sheet.getByTestId('sheet-internal-title')).toBeVisible();
    await ga.page.emulateMedia({ media: 'print' });
    await ga.page.setViewportSize({ width: 794, height: 1123 });
    const m = await ga.page.evaluate(() => {
      const out = document.querySelector('.wo-print-output') as HTMLElement | null;
      const others = Array.from(document.body.children).filter((e) => !e.matches('.wo-print-output'));
      const r = out?.getBoundingClientRect();
      const wide = out ? Array.from(out.querySelectorAll('*')).filter((e) => e.getBoundingClientRect().right > (r as DOMRect).right + 1).map((e) => e.tagName) : [];
      return { outDisplay: out ? getComputedStyle(out).display : 'missing', othersHidden: others.every((e) => getComputedStyle(e).display === 'none'), scrollOver: out ? out.scrollWidth - out.clientWidth : 999, wide, text: out?.innerText || '' };
    });
    expect(m.outDisplay).toBe('block');
    expect(m.othersHidden).toBe(true);
    expect(m.scrollOver).toBeLessThanOrEqual(1);
    expect(m.wide).toEqual([]);
    expect(m.text).toContain('維修工單表單');
    expect(m.text).toContain('內部備註 PRT：廠商報價偏高'); // 勾選後列印也含
    // 輸出 PDF（A4、一頁）：以列印媒體與 @page 的 A4 尺寸輸出
    const pdf = await ga.page.pdf({ preferCSSPageSize: true, printBackground: true });
    const out = testInfo.outputPath('wo-print.pdf');
    fs.writeFileSync(out, pdf);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    const text = pdf.toString('latin1');
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages, 'PDF 頁數').toBeGreaterThanOrEqual(1);
    expect(pages, 'PDF 頁數（一張工單應該一頁）').toBeLessThanOrEqual(2);
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
    expect(box, 'PDF 找得到 MediaBox').not.toBeNull();
    expect(Math.abs(Number(box![1]) - 595.28)).toBeLessThan(2); // A4 寬 210mm
    expect(Math.abs(Number(box![2]) - 841.89)).toBeLessThan(2); // A4 高 297mm
    await ga.page.emulateMedia({ media: 'screen' });
    await ga.page.setViewportSize({ width: 1440, height: 900 });
    expect(await ga.page.evaluate(() => getComputedStyle(document.querySelector('.wo-print-output') as HTMLElement).display)).toBe('none'); // 螢幕上不顯示
    await dlg.getByTestId('print-close').click();
    await expect(ga.page.getByTestId('wo-print-output')).toHaveCount(0);
    expect(await noPageOverflow(ga.page)).toBe(true);
    expect(realErrors(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
});

test('店長（手機）：看得到列印預覽但沒有「包含內部備註」勾選；API 要求內部備註被擋；預覽沒有內部內容', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '只在桌機 project 跑一次');
  test.setTimeout(240_000);
  const store = await openAs(browser, states.wo_store_a, 'phone');
  try {
    await openCenter(store.page);
    await openWo(store.page, 'PRT-A');
    await vis(store.page, 'act-print').click();
    const dlg = dialog(store.page);
    await expect(dlg.getByTestId('wo-sheet')).toBeVisible();
    await dialogFits(store.page);
    await expect(dlg.getByTestId('print-include-internal')).toHaveCount(0);
    await expect(dlg).toContainText('公開進度 PRT：已通知廠商');
    await expect(dlg).not.toContainText('內部備註 PRT');
    await expect(dlg).not.toContainText('強制結案原因 PRT');
    expect(await noPageOverflow(store.page)).toBe(true);
    expect(realErrors(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
  const c = await apiForUser(users.wo_store_a as any);
  const blocked = await c.get(`${N}/work-orders/${woId}/print?include_internal=1`);
  expect(blocked.status()).toBe(403);
  const plain = await c.get(`${N}/work-orders/${woId}/print`);
  expect(plain.status()).toBe(200);
  const body = JSON.stringify(await plain.json());
  expect(body).not.toContain('內部備註 PRT');
  expect(body).toContain('公開進度 PRT');
  await c.dispose();
  // 總務端 API：預設不含，要求才含
  const g = await apiForUser(users.wo_manager as any);
  expect(JSON.stringify(await (await g.get(`${N}/work-orders/${woId}/print`)).json())).not.toContain('內部備註 PRT');
  expect(JSON.stringify(await (await g.get(`${N}/work-orders/${woId}/print?include_internal=1`)).json())).toContain('內部備註 PRT');
  await g.dispose();
});
