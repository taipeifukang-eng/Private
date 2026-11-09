import { expect, type Page, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { addDays, taipeiToday } from '../../lib/workspace/general-affairs/asset-fields';
import {
  adminDb, apiForUser, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment, seedFacility, seedRepairRequest, setupM7Users, stores, type M7User,
} from '../support/m7m8-fixtures';
import { gaNavToIn, noPageOverflow, openGaCenter, pageFor, pageForUser } from '../support/g01-ui';
import { makePng } from '../support/png';

// M7/M8 第 2 批 G09 e2e：設備與設施保固管理（統計卡、保固狀態篩選、保固文件連結、分頁）與維修紀錄（逐筆與每台修過幾次、狀態與日期篩選、
// 超過一頁可翻頁、從彙總跳到某一台的紀錄、店長只看自己門市且沒有處理人欄位）。桌機 1440 與手機 390（卡片）各跑一次。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let eqCat: { id: string };
let facCat: { id: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM7Users(['real_store_manager']);
  users = s.users;
  teardownUsers = s.teardown;
  eqCat = await seedCategory('equipment', 'EC');
  facCat = await seedCategory('facility', 'FC');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first();
const rowsOf = (page: Page, text: string) => page.locator('tr:visible, li.asset-card:visible', { hasText: text });
const stat = (page: Page, label: string, noun: string) => page.getByRole('list', { name: `${noun}保固統計` }).locator('visible=true').locator('li', { hasText: label }).locator('strong');
const png = makePng({ width: 64, height: 64, inkPixels: 10 });

test('G09 設備保固管理：統計卡是整個查詢範圍的精確筆數、保固狀態篩選（台北日期）、保固文件連結可開、手機是卡片', async ({ browser }, testInfo) => {
  const today = taipeiToday();
  const mark = m7Name('WE-');
  const mk = (suffix: string, over: Record<string, unknown>) => seedEquipment('VW002', eqCat.id, `WE-${suffix}`, over);
  const expired = await mk('exp', { has_warranty: true, warranty_end_date: addDays(today, -1) });
  const todayOne = await mk('today', { has_warranty: true, warranty_end_date: today });
  const ok = await mk('ok', { has_warranty: true, warranty_end_date: addDays(today, 90), specs: { warranty_claim_method: 'ONLINE_REGISTRATION' } });
  await mk('missing', { has_warranty: true });
  await mk('none', { has_warranty: false });
  const api = await apiAs('ga_works');
  const up = await api.post('/api/workspace/general-affairs/attachments', { multipart: { resource_type: 'EQUIPMENT', resource_id: ok.id, purpose: 'WARRANTY_DOCUMENT', is_primary: 'false', files: { name: 'm7m8t-保固單.png', mimeType: 'image/png', buffer: png } } });
  expect(up.status()).toBe(201);
  await api.dispose();
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設備管理', '保固管理');
    await expect(heading(page, '設備保固管理')).toBeVisible();
    await searchBox(page).fill(mark);
    await expect(page.getByText('共 5 筆').locator('visible=true').first()).toBeVisible();
    await expect(stat(page, '設備總數', '設備')).toHaveText('5');
    await expect(stat(page, '保固中', '設備')).toHaveText('1');
    await expect(stat(page, '即將到期', '設備')).toHaveText('1'); // 到期日當天仍在保固內
    await expect(stat(page, '已過保', '設備')).toHaveText('1');
    // 依保固到期日由近到遠
    await expect(rowsOf(page, ok.name)).toContainText('上網登錄保固');
    await expect(rowsOf(page, ok.name).getByRole('link', { name: /保固單\.png/ })).toBeVisible();
    await expect(rowsOf(page, todayOne.name)).toContainText('今天到期');
    // 篩選已過保
    await page.getByLabel('保固狀態').selectOption('expired');
    await expect(page.getByText('共 1 筆').locator('visible=true').first()).toBeVisible();
    await expect(rowsOf(page, expired.name)).toBeVisible();
    await expect(stat(page, '設備總數', '設備')).toHaveText('5'); // 統計不受保固篩選影響
    await page.getByLabel('保固狀態').selectOption('');
    // 文件連結可下載
    const href = await rowsOf(page, ok.name).getByRole('link', { name: /保固單\.png/ }).first().getAttribute('href');
    expect((await fetch(href!)).status).toBe(200);
    if (testInfo.project.name === 'mobile-390') {
      await expect(page.locator('.asset-table:visible')).toHaveCount(0);
      await expect(page.locator('li.asset-card:visible').first()).toBeVisible();
    } else {
      await expect(page.locator('.asset-table:visible')).toHaveCount(1);
    }
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G09 設施保固管理：保固放在 specs 的設施也能統計與篩選；設施查看帳號看得到、沒有新增', async ({ browser }, testInfo) => {
  const today = taipeiToday();
  const mark = m7Name('WF-');
  const f1 = await seedFacility('VW002', facCat.id, 'WF-exp', { specs: { facility_has_warranty: true, facility_warranty_end_date: addDays(today, -3), facility_warranty_claim_method: 'OTHER', facility_warranty_claim_notes: '找原廠' } });
  await seedFacility('VW002', facCat.id, 'WF-ok', { specs: { facility_has_warranty: true, facility_warranty_end_date: addDays(today, 200) } });
  await seedFacility('VW002', facCat.id, 'WF-none', { specs: { facility_has_warranty: false } });
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_facility_view', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設施管理', '保固管理');
    await expect(heading(page, '設施保固管理')).toBeVisible();
    await searchBox(page).fill(mark);
    await expect(page.getByText('共 3 筆').locator('visible=true').first()).toBeVisible();
    await expect(stat(page, '設施總數', '設施')).toHaveText('3');
    await expect(stat(page, '保固中', '設施')).toHaveText('1');
    await expect(stat(page, '已過保', '設施')).toHaveText('1');
    await expect(rowsOf(page, f1.name)).toContainText('找原廠');
    await page.getByLabel('保固狀態').selectOption('none');
    await expect(page.getByText('共 1 筆').locator('visible=true').first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G09 維修紀錄：逐筆與每台修過幾次、狀態與日期篩選、超過一頁可翻頁（精確筆數）、從彙總跳到某一台；總務看得到處理人', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT03', eqCat.id, 'H-設備');
  const s = await stores();
  const rows = Array.from({ length: 23 }, (_, i) => ({
    store_id: s.ZT03.id, created_by: users.real_store_manager.id, request_type: 'REPAIR', title: m7Name(`H-${String(i).padStart(2, '0')}`), description: 'm7m8 測試', resource_type: 'EQUIPMENT',
    equipment_id: eq.id, main_status: i === 0 ? 'IN_PROGRESS' : 'COMPLETED',
  }));
  expect((await adminDb().from('ga_service_requests').insert(rows)).error).toBeNull();
  const wo = (await adminDb().from('maintenance_requests').insert({ store_id: s.ZT03.id, title: m7Name('H-wo'), reported_by: users.real_store_manager.id, reporter_name: 'm7m8', status: 'PROCESSING', assignee_name: '王師傅' }).select('id').single()).data!;
  await adminDb().from('ga_service_requests').update({ maintenance_request_id: wo.id }).eq('title', m7Name('H-00'));
  const { ctx: c, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '設備管理', '維修紀錄');
    await expect(heading(page, '設備維修紀錄')).toBeVisible();
    await searchBox(page).fill(eq.name);
    await expect(page.getByText('共 23 筆').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText('第 1 / 2 頁')).toBeVisible();
    await page.getByRole('button', { name: '下一頁' }).locator('visible=true').click();
    await expect(page.getByText('第 2 / 2 頁')).toBeVisible();
    await expect(page.locator('tr:visible, li.asset-card:visible', { hasText: m7Name('H-') })).toHaveCount(3); // 23 筆的最後 3 筆
    await page.getByRole('button', { name: '上一頁' }).locator('visible=true').click();
    // 狀態篩選
    await page.getByLabel('狀態').selectOption('OPEN');
    await expect(page.getByText('共 1 筆').locator('visible=true').first()).toBeVisible();
    const only = page.locator('tr:visible, li.asset-card:visible', { hasText: m7Name('H-00') });
    await expect(only).toBeVisible();
    await expect(only).toContainText('處理中');
    if (testInfo.project.name !== 'mobile-390') await expect(page.locator('th:visible', { hasText: '處理人' })).toHaveCount(1);
    await expect(only).toContainText('王師傅');
    await page.getByLabel('狀態').selectOption('');
    // 日期：未來日期沒有資料
    await page.getByLabel('報修日期（起）').fill(addDays(taipeiToday(), 5));
    await expect(page.getByText('共 0 筆').locator('visible=true').first()).toBeVisible();
    await page.getByLabel('報修日期（起）').fill('');
    // 每台修過幾次：跳到該台的紀錄
    await page.getByRole('tab', { name: '每台修過幾次' }).locator('visible=true').click();
    const sum = page.locator('tr:visible, li.asset-card:visible', { hasText: eq.name });
    await expect(sum).toContainText('23');
    if (testInfo.project.name === 'mobile-390') await expect(sum).toContainText(/未結案\s*1/);
    else {
      await expect(sum.locator('td').nth(2)).toHaveText('23'); // 報修次數
      await expect(sum.locator('td').nth(3)).toHaveText('1'); // 未結案
    }
    await sum.getByRole('button', { name: /看.*紀錄/ }).first().click();
    await expect(page.getByRole('tab', { name: '逐筆紀錄' }).locator('visible=true')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/只看：/)).toBeVisible();
    await expect(page.getByText('共 23 筆').locator('visible=true').first()).toBeVisible();
    if (testInfo.project.name === 'mobile-390') await expect(page.locator('.asset-table:visible')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});

test('G09 店長看設施維修紀錄：只有自己門市（他店的看不到）、沒有處理人欄位與姓名；手機是卡片', async ({ browser }, testInfo) => {
  const mine = await seedFacility('VW001', facCat.id, 'HF-自己門市');
  const theirs = await seedFacility('ZT05', facCat.id, 'HF-他店');
  const r1 = await seedRepairRequest('VW001', { facilityId: mine.id }, 'HF-mine', 'IN_PROGRESS', users.real_store_manager.id);
  await seedRepairRequest('ZT05', { facilityId: theirs.id }, 'HF-theirs', 'IN_PROGRESS', users.real_store_manager.id);
  const wo = (await adminDb().from('maintenance_requests').insert({ store_id: (await stores()).VW001.id, title: m7Name('HF-wo'), reported_by: users.real_store_manager.id, reporter_name: 'm7m8', status: 'ACCEPTED', assignee_name: '保密處理人' }).select('id').single()).data!;
  await adminDb().from('ga_service_requests').update({ maintenance_request_id: wo.id }).eq('id', r1.id);
  const api = await apiForUser(users.real_store_manager);
  const state = await api.storageState();
  await api.dispose();
  const { ctx: c, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    const side = page.locator('[data-testid="ga-shell"]:visible aside');
    if (await side.getByRole('button', { name: '設施維修紀錄', exact: true }).count()) await side.getByRole('button', { name: '設施維修紀錄', exact: true }).click();
    else await gaNavToIn(page, '設施管理', '維修紀錄');
    await expect(heading(page, '設施維修紀錄')).toBeVisible();
    await searchBox(page).fill(m7Name('HF-'));
    await expect(page.getByText('共 1 筆').locator('visible=true').first()).toBeVisible();
    await expect(rowsOf(page, m7Name('HF-mine'))).toBeVisible();
    await expect(page.locator('body')).not.toContainText('HF-theirs');
    await expect(page.locator('body')).not.toContainText('保密處理人');
    await expect(page.locator('th:visible', { hasText: '處理人' })).toHaveCount(0);
    if (testInfo.project.name === 'mobile-390') {
      await expect(page.locator('.asset-table:visible')).toHaveCount(0);
      await expect(page.locator('li.asset-card:visible').first()).toBeVisible();
    }
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await c.close();
  }
});
