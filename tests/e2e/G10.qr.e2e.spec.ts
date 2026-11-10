import { expect, type Page, test } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Code, m7Name, row, seedCategory, seedEquipment, seedFacility, stores } from '../support/m7m8-fixtures';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { gaNavToIn, noPageOverflow, openGaCenter, pageFor, visibleHeading } from '../support/g01-ui';
import { fillAndSubmitLogin } from '../support/w22-ui';

// M7/M8 第 2 批 G10 e2e（桌機 1440 與手機 390 各跑一次）：
//  - 標籤列印頁：依搜尋篩選、測試環境浮水印說明、排除已報廢並說明、無編號警告、單次 300 張上限提示、列印視窗（60 x 25 mm、浮水印、QR 圖、無編號紅字）、設施標籤；手機版面無水平溢出。
//  - 掃描頁：總務完整資訊、店長基本資訊（Q5）、他店店長與無權限者看到白話說明與店長姓名（不含資產內容）、設備查看者報修按鈕停用並說明、
//    報修按鈕連到舊版建單頁、報廢後 QR 作廢說明（總務可到清冊恢復）、恢復後舊網址又可掃。
//  - 舊永久網址 /general-affairs/assets/scan/{token}：測試站開啟轉址旗標後轉到新版掃描頁；已登入直接顯示；未登入先登入再回原頁；token 沿用不重發。
const nodeRequire = createRequire(path.join(__dirname, 'G10.qr.e2e.spec.ts'));
const { getAccount } = nodeRequire('../support/credentials.cjs') as { getAccount: (k: string) => { email: string; password: string } };
let eqCat: { id: string; code: string; name: string };
let facCat: { id: string; code: string; name: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  eqCat = await seedCategory('equipment', 'QE');
  facCat = await seedCategory('facility', 'QF');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const searchBox = (page: Page) => page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
const labelCards = (page: Page) => page.getByTestId('label-card').locator('visible=true');
const scanUrl = (token: string) => `/workspace/index.html#/open/ga-asset-scan/${token}`;
const scanBox = (page: Page) => page.getByTestId('asset-scan').locator('visible=true');
const failBox = (page: Page) => page.getByTestId('scan-failure').locator('visible=true');

test('G10 標籤列印頁（設備）：依搜尋篩選、浮水印說明、排除報廢並說明、無編號警告、列印視窗內容（60 x 25 mm、測試浮水印、QR、無編號紅字）', async ({ browser }, testInfo) => {
  const a = await seedEquipment('ZT01', eqCat.id, 'LBL-甲', { asset_code: m7Code('LA') });
  await seedEquipment('ZT01', eqCat.id, 'LBL-乙'); // 沒有編號
  const dead = await seedEquipment('ZT01', eqCat.id, 'LBL-丙');
  await adminDb().from('ga_equipment').update({ status: 'SCRAPPED' }).eq('id', dead.id);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設備管理', 'QR 標籤列印');
    await expect(visibleHeading(page, '設備 QR 標籤列印')).toBeVisible();
    await searchBox(page).fill('LBL-');
    await expect(labelCards(page)).toHaveCount(2);
    await expect(labelCards(page).filter({ hasText: a.asset_code })).toHaveCount(1);
    await expect(labelCards(page).filter({ hasText: '尚未設定編號' })).toHaveCount(1);
    await expect(page.getByTestId('label-watermark-note').locator('visible=true')).toContainText('測試');
    await expect(page.getByTestId('label-nocode').locator('visible=true')).toContainText('1 張標籤尚未設定設備編號');
    const excluded = page.getByTestId('label-excluded').locator('visible=true');
    await expect(excluded).toContainText('已排除 1 筆');
    await expect(excluded).toContainText(dead.name);
    await expect(excluded).toContainText('已報廢，QR 已作廢');
    await expect(page.getByTestId('label-truncated')).toHaveCount(0);
    // 預覽卡片上有 QR 圖與浮水印，預覽尺寸 60 x 25 mm
    const card = labelCards(page).filter({ hasText: a.asset_code }).first();
    await expect(card.locator('svg')).toHaveCount(1);
    await expect(card.locator('.wm')).toHaveText('測試');
    const box = await card.boundingBox();
    expect(Math.abs(box!.width - 226.8)).toBeLessThan(2); // 60mm
    expect(Math.abs(box!.height - 94.5)).toBeLessThan(2); // 25mm
    expect(await noPageOverflow(page)).toBe(true);

    // 列印視窗
    await page.addInitScript(() => { (window as any).__printed = 0; });
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /列印 2 張/ }).locator('visible=true').click()]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('[data-testid="print-label"]')).toHaveCount(2);
    const css = await popup.locator('style').first().textContent();
    expect(css).toContain('size: 60mm 25mm');
    await expect(popup.locator('.wm').first()).toHaveText('測試');
    await expect(popup.locator('.qr svg')).toHaveCount(2);
    await expect(popup.locator('.code.missing')).toHaveText('尚未設定編號');
    const w = await popup.locator('.label').first().evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
    expect(Math.abs(w.w - 226.8)).toBeLessThan(2);
    expect(Math.abs(w.h - 94.5)).toBeLessThan(2);
    // 標籤上的網址由設定網域產生（QR 內容無法從 SVG 讀，改驗 API）
    const api = await apiAs('ga_works');
    const res = await (await api.get(`/api/workspace/general-affairs/qr/labels?type=equipment&ids=${a.id}`)).json();
    expect(res.items[0].qrUrl).toBe(`${TEST_ORIGIN}/general-affairs/assets/scan/${a.qr_token}`);
    await api.dispose();
    await popup.close();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('G10 標籤列印頁：超過 300 張只列前 300 並提示分批；設施標籤列印同規則（退役者排除）', async ({ browser }, testInfo) => {
  const s = await stores();
  const rows = Array.from({ length: 302 }, (_, i) => ({ store_id: s.ZT05.id, category_id: eqCat.id, name: m7Name(`BIG-${String(i).padStart(3, '0')}`), brand: 'BIG', model: 'BIG' }));
  for (let i = 0; i < rows.length; i += 100) expect((await adminDb().from('ga_equipment').insert(rows.slice(i, i + 100))).error).toBeNull();
  const f1 = await seedFacility('ZT01', facCat.id, 'FL-甲', { facility_code: m7Code('FA') });
  const f2 = await seedFacility('ZT01', facCat.id, 'FL-乙');
  await adminDb().from('ga_facilities').update({ status: 'RETIRED' }).eq('id', f2.id);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設備管理', 'QR 標籤列印');
    await searchBox(page).fill('BIG-');
    await expect(labelCards(page)).toHaveCount(300, { timeout: 30_000 });
    await expect(page.getByTestId('label-truncated').locator('visible=true')).toContainText('符合條件的有 302 張，單次最多印 300 張');
    await expect(page.getByRole('button', { name: /列印 300 張/ }).locator('visible=true')).toBeEnabled();
    await searchBox(page).fill('BIG-00'); // 縮小範圍後提示消失
    await expect(labelCards(page)).toHaveCount(10);
    await expect(page.getByTestId('label-truncated')).toHaveCount(0);

    await gaNavToIn(page, '設施管理', 'QR 標籤列印');
    await expect(visibleHeading(page, '設施 QR 標籤列印')).toBeVisible();
    await searchBox(page).fill('FL-');
    await expect(labelCards(page)).toHaveCount(1);
    await expect(labelCards(page).first()).toContainText(f1.facility_code);
    await expect(page.getByTestId('label-excluded').locator('visible=true')).toContainText('已退役，QR 已作廢');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('G10 掃描頁：總務完整資訊並能開報修（舊版建單頁）；店長只看基本資訊（Q5）；設備查看者報修按鈕停用並說明；手機無水平溢出、按鈕夠大', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'SCN-1', {
    asset_code: m7Code('S1'), serial_number: 'SN-E2E-SECRET', purchase_amount: 55555, notes: '備註-不外露', area: '前場營業區', location_detail: '冷藏櫃旁', has_warranty: true, warranty_end_date: '2099-06-30',
  });
  const mobile = testInfo.project.name === 'mobile-390';
  // 總務
  const ga = await pageFor(browser, 'ga_works', testInfo);
  try {
    await ga.page.goto(scanUrl(eq.qr_token), { waitUntil: 'networkidle' });
    const box = scanBox(ga.page);
    await expect(box).toContainText(eq.name);
    await expect(box).toContainText(eq.asset_code);
    await expect(box.getByTestId('scan-status')).toHaveText('使用中');
    await expect(box.getByTestId('scan-store')).toContainText('ZT01');
    await expect(box).toContainText('冷藏櫃旁');
    await expect(box).toContainText('SN-E2E-SECRET'); // 完整層級才有序號
    await expect(box.getByTestId('scan-warranty')).toContainText('2099-06-30');
    await expect(box.getByTestId('scan-manage')).toBeVisible();
    for (const secret of ['55555', '備註-不外露']) await expect(box).not.toContainText(secret);
    const report = box.getByTestId('scan-report');
    await expect(report).toBeEnabled();
    if (mobile) expect((await report.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const [popup] = await Promise.all([ga.page.waitForEvent('popup'), report.click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(decodeURIComponent(popup.url())).toContain(`/general-affairs/reports/new?assetToken=${eq.qr_token}`);
    await popup.close();
    expect(await noPageOverflow(ga.page)).toBe(true);
    expect(ga.errors).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  // 店長（ZT01 名單內）：基本資訊
  const sm = await pageFor(browser, 'store_manager', testInfo);
  try {
    await sm.page.goto(scanUrl(eq.qr_token), { waitUntil: 'networkidle' });
    const box = scanBox(sm.page);
    await expect(box).toContainText(eq.name);
    await expect(box.getByTestId('scan-basic-note')).toContainText('僅顯示基本資料');
    for (const hidden of ['SN-E2E-SECRET', '55555', '備註-不外露', eq.brand]) await expect(box).not.toContainText(hidden);
    await expect(box.getByTestId('scan-manage')).toHaveCount(0);
    const report = box.getByTestId('scan-report');
    await expect(report).toBeEnabled();
    if (mobile) expect((await report.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noPageOverflow(sm.page)).toBe(true);
    expect(sm.errors).toEqual([]);
  } finally {
    await sm.ctx.close();
  }
  // 設備查看者：沒有建單權限
  const view = await pageFor(browser, 'ga_equipment_view', testInfo);
  try {
    await view.page.goto(scanUrl(eq.qr_token), { waitUntil: 'networkidle' });
    const box = scanBox(view.page);
    await expect(box).toContainText(eq.name);
    await expect(box.getByTestId('scan-report')).toBeDisabled();
    await expect(box.getByTestId('scan-report-reason')).toContainText('沒有建立報修單的權限');
    expect(view.errors).toEqual([]);
  } finally {
    await view.ctx.close();
  }
});

test('G10 Q5 掃描頁無權限：他店店長與無權限者看到白話說明與該門市店長姓名，看不到資產內容', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'NOA-1', { asset_code: m7Code('N1') });
  const db = adminDb();
  const links = (await db.from('store_managers').select('user_id').eq('store_id', (await stores()).ZT01.id).eq('role_type', 'store_manager')).data || [];
  const names = ((await db.from('profiles').select('full_name').in('id', links.map((l: any) => l.user_id))).data || []).map((n: any) => String(n.full_name).trim()).filter(Boolean);
  expect(names.length).toBeGreaterThan(0);
  for (const role of ['ga_store_manager_b', 'denied']) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await page.goto(scanUrl(eq.qr_token), { waitUntil: 'networkidle' });
      const fail = failBox(page);
      await expect(fail).toHaveAttribute('data-code', 'NO_ACCESS');
      await expect(fail).toContainText('沒有查看權限');
      await expect(fail).toContainText('您沒有查看這個設備／設施的權限');
      for (const n of names) await expect(page.getByTestId('scan-contacts').locator('visible=true')).toContainText(n);
      for (const leak of [eq.name, eq.asset_code]) await expect(page.locator('body')).not.toContainText(leak);
      expect(await noPageOverflow(page)).toBe(true);
      expect(errors.filter((e) => !/status of 403/.test(e)), role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('G10 Q8 作廢說明與恢復：報廢後掃描顯示作廢說明（總務有恢復入口、店長沒有）；恢復後同一個舊網址又可掃', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'REV-1', { asset_code: m7Code('R1') });
  const token = eq.qr_token;
  const api = await apiAs('ga_works');
  let cur = await row('ga_equipment', eq.id);
  expect((await api.patch(`/api/workspace/general-affairs/equipment/${eq.id}`, { data: { status: 'SCRAPPED', expected_updated_at: cur.updated_at } })).status()).toBe(200);
  const ga = await pageFor(browser, 'ga_works', testInfo);
  const sm = await pageFor(browser, 'store_manager', testInfo);
  try {
    await ga.page.goto(scanUrl(token), { waitUntil: 'networkidle' });
    await expect(failBox(ga.page)).toHaveAttribute('data-code', 'REVOKED');
    await expect(failBox(ga.page)).toContainText('這個 QR Code 已作廢');
    await expect(failBox(ga.page)).toContainText('已報廢、退役或刪除');
    await expect(failBox(ga.page)).toContainText(eq.name);
    await expect(failBox(ga.page).getByRole('button', { name: /恢復使用並重新啟用 QR/ })).toBeVisible();
    await sm.page.goto(scanUrl(token), { waitUntil: 'networkidle' });
    await expect(failBox(sm.page)).toContainText('這個 QR Code 已作廢');
    await expect(failBox(sm.page).getByRole('button', { name: /恢復使用/ })).toHaveCount(0);
    await expect(sm.page.locator('body')).not.toContainText(eq.name);
    // 總務按「到清冊恢復」會開設備清冊並帶入搜尋
    await failBox(ga.page).getByRole('button', { name: /恢復使用並重新啟用 QR/ }).click();
    await expect(visibleHeading(ga.page, '設備清冊')).toBeVisible();
    await expect(searchBox(ga.page)).toHaveValue(eq.asset_code);
    // 恢復後，同一個舊網址又可掃（token 沿用）
    cur = await row('ga_equipment', eq.id);
    expect((await api.post(`/api/workspace/general-affairs/equipment/${eq.id}/restore`, { data: { reason: '誤報廢', expected_updated_at: cur.updated_at } })).status()).toBe(200);
    expect((await row('ga_equipment', eq.id)).qr_token).toBe(token);
    const again = await ga.ctx.newPage();
    await again.goto(scanUrl(token), { waitUntil: 'networkidle' });
    await expect(again.getByTestId('asset-scan').locator('visible=true')).toContainText(eq.name);
    expect(ga.errors.concat(sm.errors).filter((e) => !/status of 404/.test(e))).toEqual([]);
  } finally {
    await api.dispose();
    await ga.ctx.close();
    await sm.ctx.close();
  }
});

test('G10 舊永久網址 /general-affairs/assets/scan/{token}：已登入直接轉到新版掃描頁；未登入先登入再回到同一台設備；轉移後 token 不變', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'PERM-1', { asset_code: m7Code('P1') });
  const token = eq.qr_token;
  const legacy = `/general-affairs/assets/scan/${token}`;
  // 已登入
  const li = await pageFor(browser, 'ga_works', testInfo);
  try {
    await li.page.goto(legacy, { waitUntil: 'networkidle' });
    await expect(li.page).toHaveURL(new RegExp('/workspace/index\\.html')); // 舊網址已轉到新版工作台（開頁籤後網址會變成 #/work/…）
    await expect(scanBox(li.page)).toContainText(eq.name);
    expect(li.errors).toEqual([]);
  } finally {
    await li.ctx.close();
  }
  // 未登入：先登入，再回到同一台
  const ctx = await browser.newContext({ baseURL: TEST_ORIGIN, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const viewport = (testInfo.project.use as { viewport?: { width: number; height: number } }).viewport;
  if (viewport) await page.setViewportSize(viewport);
  try {
    await page.goto(legacy, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('login-form')).toBeVisible();
    const cred = getAccount('ga_works');
    await fillAndSubmitLogin(page, cred.email, cred.password);
    await expect(page.getByTestId('asset-scan').locator('visible=true')).toContainText(eq.name, { timeout: 20_000 });
  } finally {
    await ctx.close();
  }
  // 換店（更正）後同一張標籤：新門市店長看得到，原門市店長看不到
  const s = await stores();
  const cur = await row('ga_equipment', eq.id);
  await adminDb().from('ga_equipment').update({ store_id: s.VW001.id }).eq('id', eq.id).eq('updated_at', cur.updated_at);
  expect((await row('ga_equipment', eq.id)).qr_token).toBe(token);
  const b = await pageFor(browser, 'ga_store_manager_b', testInfo);
  const a = await pageFor(browser, 'store_manager', testInfo);
  try {
    await b.page.goto(legacy, { waitUntil: 'networkidle' });
    await expect(scanBox(b.page)).toContainText(eq.name);
    await expect(scanBox(b.page).getByTestId('scan-store')).toContainText('VW001');
    await expect(scanBox(b.page).getByTestId('scan-report')).toBeEnabled();
    await a.page.goto(legacy, { waitUntil: 'networkidle' });
    await expect(failBox(a.page)).toHaveAttribute('data-code', 'NO_ACCESS');
  } finally {
    await b.ctx.close();
    await a.ctx.close();
  }
});
