import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser, cleanupM6Clinic, clinicFileName, runIdOrThrow, setupM6Users, testStoreIds, type M6User } from '../support/m6-fixtures';
import { claimForm, db, NEW, priceForm, send, shots } from '../support/clinic-api';
import { assertNoUnlistedDiffs, ParityRecorder, type Diff } from '../support/parity';

/**
 * M6 第三批 W31 對等：診所請款明細 PDF，舊頁（/store/clinic-selfpay-margin）與新頁（工作台）。
 * 做法：同一批自造檔，舊版批次放 VW001、新版批次放 VW002（兩店有同一份價格）；用同一個帳號（cs_margin，管轄兩店）在兩邊各開批次、按「診所請款明細PDF」，
 *   取下載檔：比對檔名（門市名稱換成占位）、PDF 頁數、頁面大小（A4）、每頁一張圖（圖片式 PDF）。基本檔 8 品項 = 1 頁；60 品項大檔 = 多頁，新舊頁數必須相同。
 * 資料：m6w30-<runId>-… 檔名、期間 2038、門市只用 VW001／VW002；只刪自己的（含儲存物件）。
 */
const recorder = new ParityRecorder('clinic-selfpay-pdf');
const Y11 = '2038-11';
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const apis: Record<string, APIRequestContext> = {};
const f = (tag: string) => clinicFileName(tag);
let ctx: BrowserContext;

test.beforeAll(async ({ browser }) => {
  runIdOrThrow();
  await cleanupM6Clinic();
  ({ users, teardown } = await setupM6Users(['cs_margin']));
  sid = await testStoreIds();
  apis.cs_margin = await apiForUser(users.cs_margin);
  const state = await apis.cs_margin.storageState();
  ctx = await browser.newContext({ baseURL: TEST_ORIGIN, storageState: state, acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  for (const store of ['VW001', 'VW002']) {
    for (const fixture of ['price-multi-month.xlsx', 'price-many.xlsx']) {
      const r = await send(apis.cs_margin, 'post', `${NEW}/prices/import`, { multipart: priceForm({ store: sid[store], month: Y11, fixture, fileName: f(`pdf-${fixture}`) }) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
  }
  // 舊版批次（VW001）用舊 API、新版批次（VW002）用新 API
  const claim = (api: string, store: string, fixture: string, tag: string) =>
    send(apis.cs_margin, 'post', `${api}/batches/import`, { multipart: claimForm({ store: sid[store], month: Y11, fixture, fileName: f(tag), shots: shots(1) }) });
  for (const [fixture, tag] of [['claim-basic.xlsx', 'pdf-basic'], ['claim-many.xlsx', 'pdf-many']]) {
    expect((await claim('/api/clinic-selfpay', 'VW001', fixture, tag)).status).toBe(200);
    expect((await claim(NEW, 'VW002', fixture, tag)).status).toBe(200);
  }
});
test.afterAll(async () => {
  await ctx?.close();
  for (const a of Object.values(apis)) await a.dispose();
  const r = await cleanupM6Clinic(db(), Object.values(users || {}).map((u) => u.id));
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
  expect(r.leftoverObjects, '桶內不應留下測試截圖').toEqual([]);
});
test.beforeEach(() => test.setTimeout(300_000));

type PdfFacts = { filename: string; pages: number; images: number; mediaBox: string[]; head: string };
const pdfFacts = (name: string, buf: Buffer, storeName: string): PdfFacts => {
  const raw = buf.toString('latin1');
  return {
    filename: name.replace(storeName, '<門市>'),
    pages: (raw.match(/\/Type\s*\/Page(?![s\w])/g) || []).length,
    images: (raw.match(/\/Subtype\s*\/Image/g) || []).length,
    mediaBox: Array.from(new Set(raw.match(/\/MediaBox\s*\[[^\]]*\]/g) || [])).map((s) => s.replace(/\s+/g, ' ')),
    head: raw.slice(0, 5),
  };
};

async function legacyPdf(page: Page, storeId: string, clinicCode: string) {
  await page.goto('/store/clinic-selfpay-margin', { waitUntil: 'networkidle' });
  const select = page.locator('select').first();
  if (await select.count()) await select.selectOption(storeId);
  const storeLine = await page.getByText(/^目前門市：/).innerText();
  const storeName = storeLine.replace(/^目前門市：\S+\s*/, '').trim();
  await page.locator('tbody tr', { hasText: clinicCode }).first().click();
  await expect(page.getByRole('button', { name: '診所請款明細PDF' })).toBeEnabled();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByRole('button', { name: '診所請款明細PDF' }).click()]);
  return pdfFacts(dl.suggestedFilename(), fs.readFileSync((await dl.path())!), storeName);
}
async function nativePdf(page: Page, storeId: string, clinicCode: string) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="診所自費藥毛利計算"]').click();
  const root = page.locator('[data-testid=clinic-selfpay]');
  await root.locator('[data-testid=store-select]').selectOption(storeId);
  const storeName = (await root.locator('[data-testid=store-select] option:checked').innerText()).replace(/^\S+\s*/, '').trim();
  await root.locator('[data-testid=batch-row]', { hasText: clinicCode }).first().click();
  await expect(root.locator('[data-testid=export-pdf]')).toBeEnabled();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), root.locator('[data-testid=export-pdf]').click()]);
  const facts = pdfFacts(dl.suggestedFilename(), fs.readFileSync((await dl.path())!), storeName);
  const last = await page.evaluate(() => (window as any).__clinicPdfLast as { pages: number });
  return { facts, domPages: last.pages };
}

for (const [label, clinic, minPages] of [['8 品項（單頁）', 'ZT038001', 1], ['60 品項（多頁）', 'ZT038009', 2]] as const) {
  test(`診所請款明細 PDF：${label}，新舊頁的檔名、頁數、頁面大小、圖片式相同`, async () => {
    const legacyPage = await ctx.newPage();
    const nativePage = await ctx.newPage();
    try {
      const l = await legacyPdf(legacyPage, sid.VW001, clinic);
      const n = await nativePdf(nativePage, sid.VW002, clinic);
      expect(l.pages, '舊頁頁數').toBeGreaterThanOrEqual(minPages);
      const diffs: Diff[] = [];
      const cmp = (key: string, a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) || diffs.push({ kind: 'changed', key, legacy: a, native: b });
      cmp('filename', l.filename, n.facts.filename);
      cmp('pages', l.pages, n.facts.pages);
      cmp('images', l.images, n.facts.images);
      cmp('mediaBox', l.mediaBox, n.facts.mediaBox);
      cmp('head', l.head, n.facts.head);
      expect(n.domPages, '新頁渲染頁數 = PDF 頁數').toBe(n.facts.pages);
      expect(l.images, '圖片式：每頁一張圖').toBe(l.pages);
      const r = recorder.record({
        entry: `claim-pdf-${clinic}`,
        mechanism: 'ui-extract',
        role: 'cs_margin',
        title: `診所請款明細 PDF（${label}）：檔名、頁數、頁面大小、圖片式相同`,
        legacy: { endpoint: '/store/clinic-selfpay-margin（舊）' },
        native: { endpoint: '/workspace 診所自費藥毛利計算（新）' },
        compared: { pages: l.pages, filename: l.filename },
        diffs,
      });
      assertNoUnlistedDiffs(r);
      expect(['pass', 'allowed', 'pending-approval'], JSON.stringify(r.diffs)).toContain(r.status);
    } finally {
      await legacyPage.close();
      await nativePage.close();
    }
  });
}
