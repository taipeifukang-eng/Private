import { expect, test, type Page } from '@playwright/test';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedEquipment, stores } from '../support/m7m8-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor } from '../support/g01-ui';
import { createRequire } from 'node:module';
import path from 'node:path';

// M7/M8 第 4 批 G27（B6，D20、D21）冒煙層（桌機 1440 與手機 390 兩個 project 各跑一次）：
// 發起轉移的確認視窗與「更正所屬門市」視窗都明確告知「進行中的單會一起轉到新門市」並顯示張數；已完成轉移單詳情看得到「搬走的單」與舊式工單清單。
// 版面：無水平溢出、無 console 錯誤。測試資料帶標記，結束清除。
const nodeRequire = createRequire(path.join(__dirname, 'G27.transfer-follow.spec.ts'));
const accountId = (k: string) => (nodeRequire('../support/credentials.cjs') as { getAccount: (k: string) => { userId: string } }).getAccount(k).userId;
let eq: any;
let done: { transferId: string; eqName: string } | null = null;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(180_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await stores();
  const cat = await seedCategory('equipment', 'G27S');
  eq = await seedEquipment('ZT01', cat.id, 'G27S-冷凍櫃');
  const uid = accountId('store_manager');
  const mk = async (type: string, status: string, suffix: string, equipmentId: string = eq.id) => ((await adminDb().from('ga_service_requests').insert({
    store_id: s.ZT01.id, created_by: uid, request_type: type, title: m7Name(`G27S-${suffix}`), description: 'smoke', resource_type: 'EQUIPMENT', equipment_id: equipmentId, main_status: status,
  }).select('*').single()).data as any);
  await mk('REPAIR', 'IN_PROGRESS', 'R');
  await mk('PURCHASE_SUPPLEMENT', 'IN_PROGRESS', 'P');
  // 已完成的轉移單與搬走明細（直接寫入，畫面只讀）
  const eq2 = await seedEquipment('VW001', cat.id, 'G27S-已轉移');
  const tr = (await adminDb().from('ga_asset_transfers').insert({
    transfer_no: `AT29991231-${String(Math.floor(Math.random() * 9000) + 1000)}`, asset_type: 'EQUIPMENT', asset_id: eq2.id, asset_name: eq2.name, asset_code: null,
    from_store_id: s.ZT01.id, to_store_id: s.VW001.id, status: 'COMPLETED', reason: 'G27 冒煙', requested_by_name: 'M7M8', open_request_count: 1,
    received_at: new Date().toISOString(), received_by_name: 'M7M8',
  }).select('*').single()).data as any;
  const evt = (await adminDb().from('ga_asset_events').insert({
    asset_type: 'EQUIPMENT', asset_id: eq2.id, asset_name: eq2.name, event_type: 'STORE_TRANSFER', from_store_id: s.ZT01.id, to_store_id: s.VW001.id, transfer_id: tr.id, reason: 'G27 冒煙',
  }).select('*').single()).data as any;
  const req = await mk('REPAIR', 'IN_PROGRESS', 'R2', eq2.id);
  await adminDb().from('ga_asset_transfer_moved_requests').insert([
    { transfer_id: tr.id, asset_event_id: evt.id, asset_type: 'EQUIPMENT', asset_id: eq2.id, kind: 'REQUEST', request_id: req.id, from_store_id: s.ZT01.id, to_store_id: s.VW001.id, moved: true, doc_no: req.request_no, doc_title: req.title, doc_status: 'IN_PROGRESS' },
  ]);
  const legacy = (await adminDb().from('maintenance_requests').insert({ store_id: s.ZT01.id, title: m7Name('G27S 舊式工單'), description: 'x', reported_by: uid, reporter_name: 'M7M8', priority: 'normal', status: 'PROCESSING', resource_type: 'equipment' }).select('*').single()).data as any;
  await adminDb().from('ga_asset_transfer_moved_requests').insert([
    { transfer_id: tr.id, asset_event_id: evt.id, asset_type: 'EQUIPMENT', asset_id: eq2.id, kind: 'UNLINKED_WORK_ORDER', work_order_id: legacy.id, from_store_id: s.ZT01.id, to_store_id: s.VW001.id, moved: false, doc_title: legacy.title, doc_status: 'PROCESSING' },
  ]);
  done = { transferId: tr.id, eqName: eq2.name };
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const dialog = (page: Page) => page.locator('dialog[open]').last();

test('發起轉移：選設備後確認視窗告知「進行中的單會一起轉到新門市」與張數；無水平溢出、無錯誤', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '轉移單');
    await page.getByRole('button', { name: '發起轉移單' }).click();
    await dialog(page).getByRole('searchbox', { name: '搜尋要轉移的資產' }).fill(eq.name);
    await dialog(page).getByRole('button', { name: `選擇 ${eq.name}` }).click();
    const note = dialog(page).getByTestId('move-follow-notice');
    await expect(note).toBeVisible();
    await expect(note).toContainText('進行中的單會一起轉到新門市');
    await expect(note.getByTestId('move-summary-line').first()).toContainText('會一起轉走 1 張進行中的維修單');
    await expect(note).toContainText('另有 1 張添購等其他類型的單留在原門市');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('設備清冊「更正所屬門市」視窗：同樣告知進行中的單會一起轉到新門市', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(eq.name);
    const card = page.locator('tr:visible, li.asset-card:visible', { hasText: eq.name }).first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /查看/ }).click();
    await dialog(page).getByRole('button', { name: '更正所屬門市' }).click();
    const note = dialog(page).getByTestId('move-follow-notice');
    await expect(note).toContainText('進行中的單會一起轉到新門市');
    await expect(note.getByTestId('move-summary-line').first()).toContainText('會一起轉走 1 張進行中的維修單');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('已完成轉移單詳情：列出搬走的單，並單獨列出沒搬、要人工處理的舊式工單', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '轉移單');
    await page.getByRole('tab', { name: '已完成' }).locator('visible=true').first().click();
    const row = page.locator('tr[data-testid="transfer-row"]:visible, li[data-testid="transfer-card"]:visible', { hasText: done!.eqName });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /查看/ }).click();
    const moved = dialog(page).getByTestId('moved-requests');
    await expect(moved).toBeVisible();
    await expect(moved.getByTestId('moved-request')).toHaveCount(1);
    await expect(moved.getByTestId('moved-unlinked')).toHaveCount(1);
    await expect(moved).toContainText('請總務人工處理');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
