import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { dialog, pick } from '../support/g12-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, M7_FILE_PREFIX, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, seedWorkOrder, stores } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { makePng } from '../support/png';

// M7/M8 第 5 批 G18.layout.e2e（工單中心與跨部門維修頁的畫面流程與版面，桌機 1440 與手機 390 各跑一次）：
//  - 工單中心：焦點卡排列、列表與詳情、更新進度（快捷鈕）、領用料件（超過庫存被擋、扣庫存、流水記工單編號、用料清單）、送門市確認、上傳照片（簽名網址載得出來）、
//    補資料（工單與需求單同進待門市補資料）、不處理強制結案（原因必填、結案方式標示、需求單同結案）、版本衝突提示、列印工單表單（內部備註預設不印、列印樣式只留表單）。
//  - 需求單詳情的工單摘要與「前往工單」。
//  - 總務組頁：回報人新增舊式回報（最多 5 張照片）、確認完成與仍有問題（仍有問題須原因）、完成後沒有重新開啟、刪除規則、維修分類管理。
// 每個彈出視窗都檢查沒有超出視窗寬度、主要按鈕在視窗內；每步用 service role 回讀資料庫。測試資料只用 VW 測試門市，結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const ids: Record<string, string> = {};
const names: Record<string, string> = {};
let part: any;
let loc: any;
const db = () => adminDb();
const wo = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).single()).data as any;
const req = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
const bal = async () => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc.id).eq('part_id', part.id).maybeSingle()).data as any)?.quantity_base ?? 0);
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_works', 'wo_manager', 'wo_store_a', 'wo_cross_store_a', 'wo_cross_manager']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  const cat = await seedCategory('part', 'G18UI');
  part = await seedPart(cat.id, 'G18UI-P1');
  loc = await seedLocation(null, 'G18UI-W');
  await seedLocationPart(loc.id, part.id);
  await seedBalance(loc.id, part.id, 10);
  const now = new Date().toISOString();
  const open = { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: now, assignee_name: 'M7M8 工務乙', handling_method: '原有處理方式' };
  ids.fresh = (await seedWorkOrder('VW001', 'UI-FRESH', users.wo_store_a.id)).id;
  ids.prog = (await seedWorkOrder('VW001', 'UI-PROG', users.wo_store_a.id, open)).id;
  ids.stale = (await seedWorkOrder('VW001', 'UI-STALE', users.wo_store_a.id, open)).id;
  const st = await stores();
  const r = (await db().from('ga_service_requests').insert({ store_id: st.VW001.id, created_by: users.wo_store_a.id, request_type: 'REPAIR', title: m7Name('UI-REQ'), description: 'm7m8 工單畫面測試',
    main_status: 'IN_PROGRESS', intake_route: 'REPAIR_DISPATCH', assignee_role: 'WORKS' }).select('*').single()).data as any;
  const w = await seedWorkOrder('VW001', 'UI-LINK', users.wo_store_a.id, { ...open, ga_service_request_id: r.id });
  await db().from('ga_service_requests').update({ maintenance_request_id: w.id }).eq('id', r.id);
  ids.link = w.id;
  ids.request = r.id;
  names.requestNo = r.request_no;
  ids.confirm1 = (await seedWorkOrder('VW001', 'UI-CONF1', users.wo_cross_store_a.id, { ...open, progress_stage: 'WAITING_STORE_CONFIRMATION' })).id;
  ids.confirm2 = (await seedWorkOrder('VW001', 'UI-CONF2', users.wo_cross_store_a.id, { ...open, progress_stage: 'WAITING_STORE_CONFIRMATION' })).id;
  ids.del = (await seedWorkOrder('VW001', 'UI-DEL', users.wo_cross_store_a.id)).id;
  ids.accepted = (await seedWorkOrder('VW001', 'UI-ACC', users.wo_cross_store_a.id, { status: 'ACCEPTED', progress_stage: 'INITIAL_REVIEW', accepted_at: now })).id;
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含工單附件）').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

async function inViewport(page: Page, testid: string) {
  const vp = page.viewportSize()!;
  const b = dialog(page).getByTestId(testid).last();
  await b.scrollIntoViewIfNeeded();
  await expect(b).toBeInViewport({ ratio: 1 });
  const box = await b.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
}
async function dialogFits(page: Page) {
  const vp = page.viewportSize()!;
  const m = await dialog(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, over: el.scrollWidth - el.clientWidth };
  });
  expect(m.left).toBeGreaterThanOrEqual(-1);
  expect(m.right).toBeLessThanOrEqual(vp.width + 1);
  expect(m.over).toBeLessThanOrEqual(1);
}
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
async function search(page: Page, term: string) {
  await vis(page, 'wob-search').fill(term);
  await expect(vis(page, 'wob-total')).toHaveText('共 1 張');
  await expect(vis(page, 'wob-card')).toHaveCount(1); // 等新的搜尋結果換上來（上一個搜尋也可能剛好是 1 張）
  await expect(vis(page, 'wob-card').first()).toContainText(term);
}
async function openWo(page: Page, term: string) {
  if (isPhone(page) && (await vis(page, 'wo-back').count())) await vis(page, 'wo-back').first().click();
  await search(page, term);
  await vis(page, 'wob-open').first().click();
  await expect(vis(page, 'wo-detail')).toBeVisible();
}
async function centerNav(page: Page) {
  await openGaCenter(page);
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: '工單中心', exact: true }).locator('visible=true').first().click();
  await expect(visibleHeading(page, '工單中心')).toBeVisible();
}

test('工單中心：焦點卡排列、更新進度（快捷鈕）、上傳照片、領用料件（超過庫存被擋、扣庫存、流水記工單編號）、送門市確認、版本衝突提示', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_works, testInfo);
  const phone = isPhone(page);
  try {
    await centerNav(page);
    // 焦點卡：桌機最多兩列、手機兩欄；不能撐出水平捲軸
    const cards = page.getByRole('list', { name: '工單焦點' }).locator('visible=true').getByRole('listitem');
    await expect(cards).toHaveCount(7);
    const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    if (phone) expect(new Set(tops).size).toBe(4);
    else expect(new Set(tops).size).toBeLessThanOrEqual(2);
    expect(await noPageOverflow(page)).toBe(true);
    await expect(vis(page, 'stat-all')).not.toHaveText('0');
    if (phone) expect((await vis(page, 'wob-open').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // 更新進度：快捷鈕帶入階段與說明
    await openWo(page, 'UI-PROG');
    await expect(vis(page, 'wo-assignee')).toHaveText('M7M8 工務乙');
    await vis(page, 'act-progress').click();
    await expect(dialog(page).getByTestId('wo-form-progress')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'wo-submit');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(dialog(page).getByTestId('wo-form-error')).toContainText('處理說明'); // 沒填說明被擋
    await dialog(page).getByTestId('quick-vendor-contacted').click();
    await expect(dialog(page).getByTestId('f-stage')).toHaveValue('WAITING_VENDOR_REPLY');
    await expect(dialog(page).getByTestId('f-notes')).toHaveValue('已聯絡廠商，等待回覆。');
    const opts = await dialog(page).getByTestId('f-stage').locator('option').allTextContents();
    expect(opts).not.toContain('處理完成待門市確認'); // 要按「送門市確認」
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wo-notice')).toContainText('進度已更新');
    const afterProgress = await wo(ids.prog);
    expect(afterProgress).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_VENDOR_REPLY', assignee_name: 'M7M8 工務乙', handling_method: '原有處理方式' }); // 有填才更新，不覆蓋承辦人與處理方式
    await expect(vis(page, 'wo-stage')).toHaveText('等待廠商回覆');
    await expect(vis(page, 'wo-timeline-item').filter({ hasText: '已聯絡廠商' })).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);

    // 上傳照片（新照片走共用附件；簽名網址要載得出來）
    const input = page.locator('[data-testid="wo-detail"]:visible').getByTestId('upload-input');
    await input.setInputFiles({ name: `${M7_FILE_PREFIX}ui-photo.png`, mimeType: 'image/png', buffer: makePng({ width: 120, height: 80, inkPixels: 30 }) });
    await vis(page, 'wo-upload').click();
    await expect(vis(page, 'wo-notice')).toContainText('照片已上傳');
    const img = vis(page, 'wo-photo').first().locator('img');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    const atts = (await db().from('ga_resource_attachments').select('resource_type,deleted_at').eq('resource_id', ids.prog)).data as any[];
    expect(atts.filter((a) => !a.deleted_at).map((a) => a.resource_type)).toEqual(['MAINTENANCE_REQUEST']);
    expect(await noPageOverflow(page)).toBe(true);

    // 領用料件：超過庫存被擋；扣庫存；流水記工單編號；用料清單
    await vis(page, 'act-issue-part').click();
    await expect(dialog(page).getByTestId('wo-form-issue_part')).toBeVisible();
    await dialogFits(page);
    await pick(dialog(page), '領用位置', '領用位置選項', loc.name, loc.name);
    await pick(dialog(page), /^料件/, '料件選項', part.name, part.name);
    await dialog(page).getByTestId('f-qty').fill('100');
    await inViewport(page, 'wo-submit');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(dialog(page).getByTestId('wo-form-error')).toBeVisible();
    expect(await bal()).toBe(10); // 被擋，沒扣庫存
    await dialog(page).getByTestId('f-qty').fill('3');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wo-notice')).toContainText('已領用料件');
    expect(await bal()).toBe(7);
    const tx = ((await db().from('ga_inventory_transactions').select('reference_type,reference_id,reason').eq('reference_id', ids.prog)).data || []) as any[];
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ reference_type: 'MAINTENANCE_REQUEST', reference_id: ids.prog });
    await expect(vis(page, 'wo-part-row')).toHaveCount(1);
    await expect(vis(page, 'wo-part-row')).toContainText('3');
    expect(await noPageOverflow(page)).toBe(true);

    // 送門市確認：之後不能再存進度、領用料件（講清楚原因）
    await vis(page, 'act-completion').click();
    await expect(dialog(page).getByTestId('wo-form-completion')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wo-notice')).toContainText('已送門市確認');
    expect(await wo(ids.prog)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
    await expect(vis(page, 'wo-next-step')).toContainText('已送門市確認');
    await expect(vis(page, 'act-progress')).toHaveCount(0);
    await expect(vis(page, 'act-issue-part')).toHaveCount(0);
    await expect(vis(page, 'reason-progress')).toContainText('已送門市確認');

    // 版本衝突：別人先更新了，再送出要提示重新載入，不能蓋掉
    await openWo(page, 'UI-STALE');
    await vis(page, 'act-progress').click();
    await dialog(page).getByTestId('f-notes').fill('這筆會被擋下');
    await db().from('maintenance_requests').update({ description: 'm7m8 被別人改過', updated_at: new Date(Date.now() + 5000).toISOString() }).eq('id', ids.stale);
    await dialog(page).getByTestId('wo-submit').click();
    await expect(dialog(page).getByTestId('wo-form-error')).toContainText('剛被其他人更新');
    await expect(dialog(page).getByTestId('wo-reload-form')).toBeVisible();
    await dialog(page).getByTestId('wo-reload-form').click();
    await expect(vis(page, 'wo-detail')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    const stale = await wo(ids.stale);
    expect(stale.progress_stage).toBe('INITIAL_REVIEW'); // 沒有被蓋掉
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('補資料與強制結案（總務管理者）：工單與需求單同進待門市補資料；強制結案原因必填、結案方式標示、需求單同結案；需求單詳情的工單摘要與「前往工單」', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_manager, testInfo);
  try {
    await centerNav(page);
    await openWo(page, 'UI-LINK');
    await expect(vis(page, 'wo-request-no')).toHaveText(names.requestNo);
    // 補資料
    await vis(page, 'act-supplement').click();
    await expect(dialog(page).getByTestId('wo-form-supplement')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('wo-submit').click();
    await expect(dialog(page).getByTestId('wo-form-error')).toContainText('請說明');
    await dialog(page).getByTestId('f-supp-type').selectOption('PHOTO_UNCLEAR');
    await dialog(page).getByTestId('f-notes').fill('照片太暗，請重拍漏水位置');
    await inViewport(page, 'wo-submit');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wo-notice')).toContainText('工單與需求單都進入「待門市補資料」');
    expect(await wo(ids.link)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_INFO' });
    expect(await req(ids.request)).toMatchObject({ main_status: 'WAITING_STORE_SUPPLEMENT', supplement_type: 'PHOTO_UNCLEAR' });
    await expect(vis(page, 'wo-next-step')).toContainText('等門市回覆');
    await expect(vis(page, 'act-supplement')).toHaveCount(0);
    await expect(vis(page, 'reason-progress')).toContainText('我的追蹤');

    // 強制結案：原因必填；門市只會看到「總務已結案」
    await vis(page, 'act-force-close').click();
    await expect(dialog(page).getByTestId('wo-form-force_close')).toBeVisible();
    await expect(dialog(page)).toContainText('原因只有總務看得到');
    await dialogFits(page);
    await inViewport(page, 'wo-submit');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(dialog(page).getByTestId('wo-form-error')).toContainText('原因');
    await dialog(page).getByTestId('f-notes').fill('門市已自行處理完畢，不需要派工');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wo-notice')).toContainText('已強制結案');
    expect(await wo(ids.link)).toMatchObject({ status: 'COMPLETED', completion_method: 'ADMIN_FORCE_CLOSED' });
    expect(await req(ids.request)).toMatchObject({ main_status: 'COMPLETED' });
    await expect(vis(page, 'wo-completion-method')).toContainText('強制結案');
    await expect(vis(page, 'wo-next-step')).toContainText('強制結案');
    for (const t of ['act-progress', 'act-completion', 'act-force-close', 'act-supplement', 'act-issue-part']) await expect(vis(page, t), t).toHaveCount(0);
    await expect(vis(page, 'wo-timeline-item').filter({ hasText: '總務已結案' }).first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);

    // 列表以「結案方式」標示強制結案
    if (isPhone(page)) await vis(page, 'wo-back').first().click();
    await search(page, 'UI-LINK');
    await expect(vis(page, 'row-completion')).toContainText('強制結案');

    // 需求單詳情：工單摘要（階段、公開進度、結案方式）與「前往工單」
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '總務需求工作台', exact: true }).locator('visible=true').first().click();
    await expect(visibleHeading(page, '總務需求工作台')).toBeVisible();
    await page.getByPlaceholder('需求單號、標題、說明（可含逗號、括號）').locator('visible=true').fill(names.requestNo);
    await expect(page.getByTestId('rq-total').locator('visible=true')).toHaveText('共 1 張');
    await page.getByTestId('open-detail').locator('visible=true').first().click();
    await expect(dialog(page).getByTestId('wo-summary')).toBeVisible();
    await expect(dialog(page).getByTestId('wos-completion')).toContainText('強制結案');
    await expect(dialog(page).getByTestId('wos-progress')).toContainText('總務已結案');
    await dialogFits(page);
    await dialog(page).getByTestId('wos-goto').click();
    await expect(visibleHeading(page, '工單中心')).toBeVisible();
    await expect(vis(page, 'wo-no')).toHaveText(`WO-${ids.link.slice(0, 8).toUpperCase()}`);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('列印工單表單：預覽不含內部備註（預設不勾），勾選後才出現；列印樣式只留表單（A4）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_manager, testInfo);
  try {
    await centerNav(page);
    await openWo(page, 'UI-LINK');
    await vis(page, 'act-print').click();
    await expect(dialog(page).getByTestId('wo-print-dialog')).toBeVisible();
    await expect(dialog(page).getByTestId('wo-sheet')).toBeVisible();
    await dialogFits(page);
    await expect(dialog(page).getByTestId('print-include-internal')).not.toBeChecked();
    await expect(dialog(page).getByTestId('sheet-internal-title')).toHaveCount(0);
    await expect(dialog(page).getByTestId('sheet-force-reason')).toHaveCount(0);
    await expect(dialog(page)).not.toContainText('門市已自行處理完畢'); // 強制結案原因預設不印
    await dialog(page).getByTestId('print-include-internal').check();
    await expect(dialog(page).getByTestId('sheet-internal-title')).toBeVisible();
    await expect(dialog(page).getByTestId('sheet-force-reason')).toContainText('門市已自行處理完畢');
    await inViewport(page, 'print-go');
    // 列印媒體：只留 .wo-print-output，其餘都隱藏
    await page.emulateMedia({ media: 'print' });
    const m = await page.evaluate(() => {
      const out = document.querySelector('.wo-print-output') as HTMLElement | null;
      const others = Array.from(document.body.children).filter((e) => !e.matches('.wo-print-output'));
      return { outDisplay: out ? getComputedStyle(out).display : 'missing', othersHidden: others.every((e) => getComputedStyle(e).display === 'none'), count: others.length };
    });
    expect(m.outDisplay).toBe('block');
    expect(m.othersHidden).toBe(true);
    expect(m.count).toBeGreaterThan(0);
    await page.emulateMedia({ media: 'screen' });
    const hiddenOnScreen = await page.evaluate(() => getComputedStyle(document.querySelector('.wo-print-output') as HTMLElement).display);
    expect(hiddenOnScreen).toBe('none');
    await dialog(page).getByTestId('print-close').click();
    await expect(page.getByTestId('wo-print-output')).toHaveCount(0);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('總務組頁（回報人）：新增回報（最多 5 張照片）、確認完成、仍有問題須原因、完成後沒有重新開啟、刪除規則（已受理不可刪）', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_cross_store_a, testInfo);
  try {
    await openFromMenu(page, '總務組');
    await expect(visibleHeading(page, '總務組維修')).toBeVisible();
    // 新增回報：6 張被擋、2 張可送
    await vis(page, 'wob-create').click();
    await expect(dialog(page).getByTestId('wo-create-form')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'c-submit');
    await expect(dialog(page).getByTestId('c-store')).toHaveValue(/.+/); // 等門市清單載入（只有一間門市時自動帶入）
    await dialog(page).getByTestId('c-submit').click();
    await expect(dialog(page).getByTestId('c-error')).toContainText('標題'); // 只有一間門市時自動帶入，所以先擋標題
    const png = (n: number) => ({ name: `${M7_FILE_PREFIX}ui-${n}.png`, mimeType: 'image/png', buffer: makePng({ width: 100 + n, height: 80, inkPixels: 20 + n }) });
    await dialog(page).getByTestId('upload-input').setInputFiles([1, 2, 3, 4, 5, 6].map(png));
    await expect(dialog(page).locator('.field-error').filter({ hasText: '最多一次上傳 5' })).toBeVisible();
    await expect(dialog(page).getByLabel('待上傳的檔案').getByRole('listitem')).toHaveCount(5);
    for (const n of [5, 4, 3]) await dialog(page).getByRole('button', { name: `移除 ${M7_FILE_PREFIX}ui-${n}.png` }).click();
    await expect(dialog(page).getByLabel('待上傳的檔案').getByRole('listitem')).toHaveCount(2);
    const title = m7Name('UI-NEW');
    await dialog(page).getByTestId('c-title').fill(title);
    await dialog(page).getByTestId('c-description').fill('飲水機漏水');
    await dialog(page).getByTestId('c-submit').click();
    await expect(vis(page, 'wob-notice')).toContainText('已建立工單');
    const created = ((await db().from('maintenance_requests').select('id,status,reported_by').eq('title', title)).data || []) as any[];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: 'UNACCEPTED', reported_by: users.wo_cross_store_a.id });
    const att = ((await db().from('ga_resource_attachments').select('id,deleted_at').eq('resource_id', created[0].id).eq('resource_type', 'MAINTENANCE_REQUEST')).data || []) as any[];
    expect(att.filter((a) => !a.deleted_at)).toHaveLength(2);
    expect(await noPageOverflow(page)).toBe(true);

    // 確認完成（沒有重新開啟）
    await openWo(page, 'UI-CONF1');
    await expect(vis(page, 'wo-next-step')).toContainText('確認問題是否解決');
    await vis(page, 'act-store-confirm').click();
    await expect(dialog(page).getByTestId('wo-form-store_confirm')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'wo-submit');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wo-notice')).toContainText('已確認完成');
    expect(await wo(ids.confirm1)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED' });
    await expect(vis(page, 'wo-completion-method')).toContainText('門市確認完成');
    await expect(vis(page, 'wo-next-step')).toContainText('不能重新開啟');
    await expect(page.getByRole('button', { name: /重新開啟/ }).locator('visible=true')).toHaveCount(0);
    for (const t of ['act-store-confirm', 'act-unresolved', 'act-progress', 'act-delete']) await expect(vis(page, t), t).toHaveCount(0);

    // 仍有問題：必須填原因
    await openWo(page, 'UI-CONF2');
    await vis(page, 'act-unresolved').click();
    await dialog(page).getByTestId('wo-submit').click();
    await expect(dialog(page).getByTestId('wo-form-error')).toContainText('還有什麼問題');
    expect(await wo(ids.confirm2)).toMatchObject({ progress_stage: 'WAITING_STORE_CONFIRMATION' });
    await dialog(page).getByTestId('f-notes').fill('水龍頭還是會滴水');
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wo-notice')).toContainText('已回報仍有問題');
    expect(await wo(ids.confirm2)).toMatchObject({ status: 'PROCESSING', progress_stage: 'REOPENED', unresolved_reason: '水龍頭還是會滴水' });

    // 刪除規則：已受理不能刪（講原因）；未受理可刪
    await openWo(page, 'UI-ACC');
    await expect(vis(page, 'act-delete')).toHaveCount(0);
    await expect(vis(page, 'reason-delete')).toContainText('已受理');
    await openWo(page, 'UI-DEL');
    await vis(page, 'act-delete').click();
    await expect(dialog(page).getByTestId('wo-form-delete')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('wo-submit').click();
    await expect(vis(page, 'wob-notice')).toContainText('工單已刪除');
    expect((await db().from('maintenance_requests').select('id').eq('id', ids.del).maybeSingle()).data).toBeNull();
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('總務組頁（分類管理者）：維修分類新增、重名白話提示、改名、停用；視窗不超出畫面', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_cross_manager, testInfo);
  try {
    await openFromMenu(page, '總務組');
    await expect(visibleHeading(page, '總務組維修')).toBeVisible();
    await vis(page, 'wob-categories').click();
    await expect(dialog(page).getByTestId('cat-dialog')).toBeVisible();
    await dialogFits(page);
    const name = m7Name('UI-CAT');
    await dialog(page).getByTestId('cat-new').fill(name);
    await dialog(page).getByTestId('cat-add').click();
    await expect(dialog(page).getByTestId('cat-notice')).toContainText('分類已新增');
    await expect(dialog(page).getByTestId('cat-row').filter({ hasText: name })).toHaveCount(1);
    await dialog(page).getByTestId('cat-new').fill(name.toUpperCase());
    await dialog(page).getByTestId('cat-add').click();
    await expect(dialog(page).getByTestId('cat-error')).toContainText('已有相同名稱');
    const row = dialog(page).getByTestId('cat-row').filter({ hasText: name });
    await row.getByTestId('cat-edit').click();
    await dialog(page).getByTestId('cat-edit-name').fill(`${name}-改`);
    await dialog(page).getByTestId('cat-save').click();
    await expect(dialog(page).getByTestId('cat-notice')).toContainText('分類已儲存');
    const row2 = dialog(page).getByTestId('cat-row').filter({ hasText: `${name}-改` });
    await expect(row2).toHaveCount(1);
    await row2.getByTestId('cat-toggle').click();
    await expect(dialog(page).getByTestId('cat-notice')).toContainText('已停用');
    const dbRow = (await db().from('maintenance_categories').select('name,is_active').eq('name', `${name}-改`).single()).data as any;
    expect(dbRow.is_active).toBe(false);
    await inViewport(page, 'cat-close');
    await dialog(page).getByTestId('cat-close').click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
