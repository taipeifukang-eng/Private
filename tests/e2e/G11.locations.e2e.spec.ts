import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  adminDb, apiForUser, assertGaBaseline, cleanupM7M8, m7Code, m7Name, row, rowsWhere, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, seedTransfer, setupM7Users, stores,
  type M7User,
} from '../support/m7m8-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor, pageForUser } from '../support/g01-ui';

// M7/M8 第 3 批 G11 e2e（桌機 1440 與手機 390 各跑一次）：
//  主要流程：總務建立位置 → 對話框不關閉、切到編輯 → 多選料件批次加入（共用預設數字、逐筆調整）→ 逐筆修改 → 停用／啟用 → 移除（原因必填）；
//  失敗分支：必填與重複代碼、未存變更離開確認、預設位置衝突確認、負庫存確認、版本衝突（別人先改）、停用／刪除先看影響範圍（進行中調撥擋、庫存要確認）、有交易後鎖定；
//  唯讀：店長、督導、區經理（名單身分）手機也能看自己門市，沒有操作按鈕，看不到內部描述與備註。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let sid: Record<string, string> = {};
let partCat: { id: string };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupM7Users(['roster_supervisor', 'roster_area_manager']);
  users = made.users;
  teardownUsers = made.teardown;
  sid = Object.fromEntries(Object.entries(await stores()).map(([k, v]) => [k, v.id]));
  partCat = await seedCategory('part', 'G11E');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

// 故意送出會被伺服器拒絕的請求（409／400）時，瀏覽器會在 console 記一行「Failed to load resource」，不算頁面錯誤。
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const dialog = (page: Page) => page.locator('dialog[open]').last();
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();
/** 位置列：桌機是表格列，手機是卡片。 */
const locRow = (page: Page, text: string) => page.locator('[data-testid="location-row"]:visible, [data-testid="location-card"]:visible', { hasText: text });
const settingRow = (page: Page, text: string) => dialog(page).locator('[data-testid="setting-row"]:visible, li.setting-card:visible', { hasText: text });
async function openPage(page: Page) {
  await openGaCenter(page);
  await gaNavTo(page, '庫存位置', '庫存管理');
  await expect(page.getByRole('heading', { name: '庫存位置與料件設定', exact: true }).locator('visible=true').first()).toBeVisible();
}
async function findRow(page: Page, name: string) {
  await searchBox(page).fill(name);
  const r = locRow(page, name);
  await expect(r).toHaveCount(1);
  return r;
}
async function openEdit(page: Page, name: string) {
  const r = await findRow(page, name);
  await r.getByRole('button', { name: /^編輯|^查看/ }).click();
  await expect(dialog(page).getByLabel('位置名稱')).toHaveValue(name);
}
const manage = async (page: Page, name: string, action: RegExp) => (await findRow(page, name)).getByRole('button', { name: action }).click();
const sub = (loc: Locator, label: string) => loc.getByLabel(label, { exact: true });
const partState = async (id: string) => rowsWhere('ga_inventory_location_parts', 'id', id).then((r) => r[0]);

const managerState = async (u: M7User) => {
  const api = await apiForUser(u as any);
  const state = await api.storageState();
  await api.dispose();
  return state;
};

test('總務主要流程：建立位置（建立後不關閉、切到編輯）→ 多選 3 個料件批次加入（共用數字＋逐筆調整）→ 修改 → 停用／啟用 → 移除（原因必填）', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const pa = await seedPart(partCat.id, 'E2E-甲');
  const pb = await seedPart(partCat.id, 'E2E-乙');
  const pc = await seedPart(partCat.id, 'E2E-丙');
  const name = m7Name('E2E-主流程');
  const code = m7Code('e2e1').toLowerCase();
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openPage(page);
    // ---- 必填與重複代碼
    await page.getByRole('button', { name: '新增位置' }).locator('visible=true').click();
    await expect(dialog(page).getByRole('heading', { name: '新增庫存位置' })).toBeVisible();
    await sub(dialog(page), '位置類型').selectOption({ label: '辦公室' });
    await dialog(page).getByRole('button', { name: '新增位置' }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '請輸入位置名稱' })).toBeVisible();
    expect(await rowsWhere('ga_inventory_locations', 'name', name)).toEqual([]);
    await seedLocation(null, 'E2E-已有代碼', { code: code.toUpperCase() });
    await sub(dialog(page), '位置名稱').fill(name);
    await sub(dialog(page), '位置代碼').fill(code);
    await sub(dialog(page), '位置描述').fill('內部描述 e2e');
    await dialog(page).getByRole('button', { name: '新增位置' }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '代碼已被使用' })).toBeVisible();
    expect(await rowsWhere('ga_inventory_locations', 'name', name)).toEqual([]);
    // ---- 成功：不關閉，切到編輯，出現料件設定面板
    await adminDb().from('ga_inventory_locations').update({ code: m7Code('e2e1-moved') }).eq('name', m7Name('E2E-已有代碼'));
    await dialog(page).getByRole('button', { name: '新增位置' }).click();
    await expect(dialog(page).getByRole('heading', { name: '編輯庫存位置' })).toBeVisible();
    await expect(dialog(page).getByTestId('location-parts')).toBeVisible();
    await expect(notice(page, `已新增位置「${name}」`)).toBeVisible();
    const loc = (await rowsWhere('ga_inventory_locations', 'name', name))[0];
    expect(loc).toMatchObject({ code: code.toUpperCase(), location_type: 'OFFICE', description: '內部描述 e2e', is_active: true });
    // ---- 批次加入：共用預設數字，再逐筆調整
    await dialog(page).getByRole('button', { name: '加入料件', exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: '加入料件設定' })).toBeVisible();
    await sub(dialog(page), '共用安全庫存').fill('2');
    await sub(dialog(page), '共用補貨點').fill('5');
    await sub(dialog(page), '共用最高庫存').fill('10');
    await sub(dialog(page), '共用偏好領用單位').selectOption('BASE');
    await sub(dialog(page), '共用備註').fill('共用備註 e2e');
    await dialog(page).getByLabel('加入料件', { exact: true }).fill(m7Name('E2E-'));
    for (const p of [pa, pb, pc]) {
      const li = dialog(page).getByRole('list', { name: '料件搜尋結果' }).getByRole('listitem').filter({ hasText: p.name });
      await expect(li).toBeVisible();
      await li.getByRole('button', { name: '加入', exact: true }).click();
    }
    await expect(dialog(page).locator('[data-testid="draft-row"]')).toHaveCount(3);
    await sub(dialog(page), `${pb.name} 最高庫存`).fill('20');
    await expect(sub(dialog(page), `${pa.name} 安全庫存`)).toHaveValue('2');
    await dialog(page).getByRole('button', { name: '加入 3 筆' }).click();
    await expect(notice(page, '已加入 3 筆料件設定')).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: '編輯庫存位置' })).toBeVisible();
    for (const p of [pa, pb, pc]) await expect(settingRow(page, p.name)).toBeVisible();
    let rows = (await rowsWhere('ga_inventory_location_parts', 'location_id', loc.id)).filter((r) => !r.deleted_at);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.part_id === pb.id)).toMatchObject({ safety_stock_qty: 2, reorder_point_qty: 5, maximum_stock_qty: 20, preferred_issue_unit_type: 'BASE', notes: '共用備註 e2e' });
    expect(rows.find((r) => r.part_id === pa.id)!.maximum_stock_qty).toBe(10);
    // ---- 修改（逐筆）：順序錯誤被擋；改對後儲存
    await settingRow(page, pa.name).getByRole('button', { name: /^修改/ }).click();
    await expect(dialog(page).getByRole('heading', { name: `修改設定：${pa.name}` })).toBeVisible();
    await sub(dialog(page), '安全庫存').fill('50');
    await dialog(page).getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '安全庫存不可大於' })).toBeVisible();
    await sub(dialog(page), '安全庫存').fill('3');
    await sub(dialog(page), '備註').fill('修改後備註');
    await dialog(page).getByRole('button', { name: '儲存', exact: true }).click();
    await expect(notice(page, `已儲存「${pa.name}」的設定`)).toBeVisible();
    expect(await rowsWhere('ga_inventory_location_parts', 'part_id', pa.id).then((r) => r.find((x) => x.location_id === loc.id))).toMatchObject({ safety_stock_qty: 3, notes: '修改後備註' });
    // ---- 停用／啟用
    await settingRow(page, pb.name).getByRole('button', { name: /^停用/ }).click();
    await expect(notice(page, `已停用「${pb.name}」的設定`)).toBeVisible();
    await expect(settingRow(page, pb.name)).toContainText('已停用');
    expect((await rowsWhere('ga_inventory_location_parts', 'part_id', pb.id)).find((x) => x.location_id === loc.id)!.is_active).toBe(false);
    await settingRow(page, pb.name).getByRole('button', { name: /^啟用/ }).click();
    await expect(notice(page, `已啟用「${pb.name}」的設定`)).toBeVisible();
    expect((await rowsWhere('ga_inventory_location_parts', 'part_id', pb.id)).find((x) => x.location_id === loc.id)!.is_active).toBe(true);
    // ---- 移除：原因必填
    await settingRow(page, pc.name).getByRole('button', { name: /^移除/ }).click();
    await expect(dialog(page).getByRole('heading', { name: '移除料件設定' })).toBeVisible();
    await dialog(page).getByRole('button', { name: '確認移除' }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '請輸入移除原因' })).toBeVisible();
    await sub(dialog(page), '移除原因').fill('e2e 移除');
    await dialog(page).getByRole('button', { name: '確認移除' }).click();
    await expect(notice(page, `已移除「${pc.name}」的設定`)).toBeVisible();
    await expect(settingRow(page, pc.name)).toHaveCount(0);
    rows = await rowsWhere('ga_inventory_location_parts', 'location_id', loc.id);
    expect(rows.find((r) => r.part_id === pc.id)).toMatchObject({ is_active: false, deletion_reason: 'e2e 移除' });
    expect(rows.find((r) => r.part_id === pc.id)!.deleted_at).not.toBeNull();
    // ---- 關閉對話框後清單的設定筆數更新、統計卡有數字
    await dialog(page).getByRole('button', { name: '取消' }).click();
    await expect(locRow(page, name)).toContainText(/2 項(料件)?設定/);
    await expect(page.getByTestId('stat-total').locator('visible=true')).not.toHaveText('0');
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('新增門市位置：選門市（搜尋選擇器）、設為預設；同門市已有預設時要確認才換；允許負庫存要確認；未存變更離開要確認', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const first = await seedLocation('ZT05', 'E2E-預設甲', { is_default: true });
  const name = m7Name('E2E-預設乙');
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openPage(page);
    await page.getByRole('button', { name: '新增位置' }).locator('visible=true').click();
    await sub(dialog(page), '位置名稱').fill(name);
    // 門市類型沒選門市：被擋
    await dialog(page).getByRole('button', { name: '新增位置' }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '必須選擇門市' })).toBeVisible();
    const box = dialog(page).getByRole('combobox', { name: /所屬門市/ });
    await box.fill('ZT05');
    await dialog(page).getByRole('option').filter({ hasText: 'ZT05' }).first().getByRole('button').click();
    await sub(dialog(page), '預設位置').check();
    // 負庫存要確認：先取消（維持未勾選），再確認
    await dialog(page).getByLabel('允許負庫存', { exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: '允許負庫存？' })).toBeVisible();
    await dialog(page).getByRole('button', { name: '取消' }).last().click();
    await expect(dialog(page).getByLabel('允許負庫存', { exact: true })).not.toBeChecked();
    await dialog(page).getByLabel('允許負庫存', { exact: true }).click();
    await dialog(page).getByRole('button', { name: '確定允許' }).click();
    await expect(dialog(page).getByLabel('允許負庫存', { exact: true })).toBeChecked();
    // 預設衝突：先按取消，什麼都沒換；再確認
    await dialog(page).getByRole('button', { name: '新增位置' }).click();
    await expect(dialog(page).getByRole('heading', { name: '改由這個位置成為預設？' })).toBeVisible();
    await expect(dialog(page)).toContainText(first.name);
    await dialog(page).getByRole('button', { name: '取消' }).click();
    expect(await rowsWhere('ga_inventory_locations', 'name', name)).toEqual([]);
    expect((await row('ga_inventory_locations', first.id)).is_default).toBe(true);
    await dialog(page).getByRole('button', { name: '新增位置' }).click();
    await dialog(page).getByRole('button', { name: '確認改為預設' }).click();
    await expect(dialog(page).getByRole('heading', { name: '編輯庫存位置' })).toBeVisible();
    const made = (await rowsWhere('ga_inventory_locations', 'name', name))[0];
    expect(made).toMatchObject({ store_id: sid.ZT05, is_default: true, allow_negative_stock: true, location_type: 'STORE' });
    expect((await row('ga_inventory_locations', first.id)).is_default).toBe(false);
    // 未存變更離開：繼續編輯 / 放棄
    await sub(dialog(page), '位置名稱').fill(`${name} 改`);
    await dialog(page).getByRole('button', { name: '取消', exact: true }).first().click();
    await expect(dialog(page).getByRole('heading', { name: '放棄未儲存的變更？' })).toBeVisible();
    await dialog(page).getByRole('button', { name: '繼續編輯' }).click();
    await expect(sub(dialog(page), '位置名稱')).toHaveValue(`${name} 改`);
    await dialog(page).getByRole('button', { name: '取消', exact: true }).first().click();
    await dialog(page).getByRole('button', { name: '放棄變更' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    expect((await row('ga_inventory_locations', made.id)).name).toBe(name);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('版本衝突：別人先改了位置，儲存時顯示「已被其他人修改」並可重新載入；有交易的位置鎖定類型、門市、代碼並說明', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const stale = await seedLocation('ZT04', 'E2E-衝突');
  const locked = await seedLocation('ZT04', 'E2E-鎖定');
  const part = await seedPart(partCat.id, 'E2E-鎖定料件');
  await seedBalance(locked.id, part.id, 0);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openPage(page);
    await openEdit(page, stale.name);
    await expect(dialog(page).locator('.site-chosen')).toContainText('ZT04'); // 編輯門市位置要顯示門市代碼與名稱，不是 id 的一小段
    await adminDb().from('ga_inventory_locations').update({ description: '別人先改的描述' }).eq('id', stale.id);
    await sub(dialog(page), '位置描述').fill('我的描述');
    await dialog(page).getByRole('button', { name: '儲存位置' }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '已被其他人修改' })).toBeVisible();
    expect((await row('ga_inventory_locations', stale.id)).description).toBe('別人先改的描述');
    await dialog(page).getByRole('button', { name: '重新載入這個位置' }).click();
    await expect(sub(dialog(page), '位置描述')).toHaveValue('別人先改的描述');
    await sub(dialog(page), '位置描述').fill('重新載入後我的描述');
    await dialog(page).getByRole('button', { name: '儲存位置' }).click();
    await expect(notice(page, `已儲存位置「${stale.name}」`)).toBeVisible();
    expect((await row('ga_inventory_locations', stale.id)).description).toBe('重新載入後我的描述');
    await dialog(page).getByRole('button', { name: '取消' }).first().click();
    // 鎖定
    await openEdit(page, locked.name);
    await expect(dialog(page).getByTestId('lock-note')).toContainText('要換店請新增位置');
    await expect(sub(dialog(page), '位置類型')).toBeDisabled();
    await expect(sub(dialog(page), '位置代碼')).toBeDisabled();
    await expect(dialog(page).getByRole('combobox', { name: /所屬門市/ })).toBeDisabled();
    await expect(sub(dialog(page), '位置名稱')).toBeEnabled();
    await sub(dialog(page), '位置名稱').fill(`${locked.name} 改名`);
    await dialog(page).getByRole('button', { name: '儲存位置' }).click();
    await expect(notice(page, '已儲存位置')).toBeVisible();
    expect((await row('ga_inventory_locations', locked.id)).name).toBe(`${locked.name} 改名`);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('停用與刪除先看影響範圍：進行中調撥直接擋；有庫存停用要確認、刪除直接擋；沒有庫存的位置刪除要原因', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const part = await seedPart(partCat.id, 'E2E-影響料件');
  const busy = await seedLocation('ZT04', 'E2E-調撥中');
  const other = await seedLocation('ZT05', 'E2E-調撥對方');
  await seedLocationPart(busy.id, part.id);
  await seedLocationPart(other.id, part.id);
  const tr = await seedTransfer(busy.id, other.id, part.id, 'E2E-T', 'SOURCE_CONFIRMED');
  const stocked = await seedLocation('ZT04', 'E2E-有庫存');
  await seedLocationPart(stocked.id, part.id);
  await seedBalance(stocked.id, part.id, 3);
  const empty = await seedLocation('ZT04', 'E2E-可刪除');
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openPage(page);
    // 進行中調撥：停用與刪除都擋
    for (const [action, title] of [[/^停用/, '停用庫存位置'], [/^刪除/, '刪除庫存位置']] as const) {
      await manage(page, busy.name, action);
      await expect(dialog(page).getByRole('heading', { name: title })).toBeVisible();
      await expect(dialog(page).getByTestId('impact-blocked')).toContainText('1 張進行中的調撥單');
      await expect(dialog(page)).toContainText(tr.transfer_no);
      await expect(dialog(page).getByRole('button', { name: /^確認/ })).toHaveCount(0);
      await dialog(page).getByRole('button', { name: '關閉' }).click();
    }
    expect(await row('ga_inventory_locations', busy.id)).toMatchObject({ is_active: true, deleted_at: null });
    // 有庫存：刪除直接擋；停用要確認
    await manage(page, stocked.name, /^刪除/);
    await expect(dialog(page).getByTestId('impact-blocked')).toContainText('1 項庫存');
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    await manage(page, stocked.name, /^停用/);
    await expect(dialog(page).getByTestId('impact-text')).toContainText('1 項庫存');
    await expect(dialog(page).getByTestId('impact-warn')).toContainText('庫存仍保留');
    await dialog(page).getByRole('button', { name: '確認停用' }).click();
    await expect(notice(page, `已停用位置「${stocked.name}」`)).toBeVisible();
    expect((await row('ga_inventory_locations', stocked.id)).is_active).toBe(false);
    await expect(locRow(page, stocked.name)).toContainText('已停用');
    // 重新啟用
    await manage(page, stocked.name, /^啟用/);
    await expect(notice(page, `已啟用位置「${stocked.name}」`)).toBeVisible();
    expect((await row('ga_inventory_locations', stocked.id)).is_active).toBe(true);
    // 沒有庫存：刪除要原因
    await manage(page, empty.name, /^刪除/);
    await expect(dialog(page).getByTestId('impact-text')).toContainText('0 筆料件設定');
    await dialog(page).getByRole('button', { name: '確認刪除' }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '請輸入刪除原因' })).toBeVisible();
    await sub(dialog(page), '刪除原因').fill('e2e 刪除');
    await dialog(page).getByRole('button', { name: '確認刪除' }).click();
    await expect(notice(page, `已刪除位置「${empty.name}」`)).toBeVisible();
    expect(await row('ga_inventory_locations', empty.id)).toMatchObject({ deletion_reason: 'e2e 刪除' });
    expect((await row('ga_inventory_locations', empty.id)).deleted_at).not.toBeNull();
    await searchBox(page).fill(empty.name);
    await expect(locRow(page, empty.name)).toHaveCount(0);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('唯讀（C12）：店長、督導、區經理在桌機與手機都能看自己門市的位置與料件設定；沒有操作按鈕、欄位不能改、看不到內部描述與備註；看不到別店', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const part = await seedPart(partCat.id, 'E2E-唯讀料件');
  const mine = await seedLocation('ZT01', 'E2E-唯讀本店', { description: '內部描述-唯讀' });
  const other = await seedLocation('VW001', 'E2E-唯讀他店', { description: '內部描述-他店' });
  await seedLocationPart(mine.id, part.id, { notes: '內部備註-唯讀', safety_stock_qty: 4 });
  // store_manager 是矩陣帳號（自訂店長角色，舊側欄不列庫存群組，「庫存位置」補在最上層）；名單身分督導與區經理的帳號掛了 DEV 真正的 store_manager 角色，「庫存位置」在「庫存管理」群組底下。
  const states: [string, any, boolean][] = [
    ['store_manager', undefined, false],
    ['roster_supervisor', await managerState(users.roster_supervisor), true],
    ['roster_area_manager', await managerState(users.roster_area_manager), true],
  ];
  for (const [role, state, grouped] of states) {
    const { ctx, page, errors } = state ? await pageForUser(browser, state, testInfo) : await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      await gaNavTo(page, '庫存位置', grouped ? '庫存管理' : undefined);
      await expect(page.getByRole('heading', { name: '庫存位置與料件設定', exact: true }).locator('visible=true').first(), role).toBeVisible();
      await expect(page.getByTestId('readonly-note').locator('visible=true'), role).toContainText('只會看到自己門市');
      await expect(page.getByRole('button', { name: '新增位置' }), role).toHaveCount(0);
      await searchBox(page).fill(m7Name('E2E-唯讀'));
      await expect(locRow(page, mine.name), role).toHaveCount(1);
      await expect(locRow(page, other.name), role).toHaveCount(0);
      await expect(locRow(page, mine.name).getByRole('button', { name: /^停用|^刪除|^啟用/ }), role).toHaveCount(0);
      await locRow(page, mine.name).getByRole('button', { name: /^查看/ }).click();
      await expect(dialog(page).getByRole('heading', { name: '庫存位置', exact: true }), role).toBeVisible();
      await expect(sub(dialog(page), '位置名稱'), role).toBeDisabled();
      await expect(dialog(page).getByRole('button', { name: '儲存位置' }), role).toHaveCount(0);
      await expect(dialog(page).getByRole('button', { name: '加入料件' }), role).toHaveCount(0);
      await expect(settingRow(page, part.name), role).toBeVisible();
      await expect(settingRow(page, part.name), role).toContainText('4');
      await expect(settingRow(page, part.name).getByRole('button', { name: /^修改|^停用|^移除/ }), role).toHaveCount(0);
      expect(await dialog(page).innerText(), role).not.toContain('內部');
      await dialog(page).getByRole('button', { name: '關閉' }).first().click();
      expect(await noPageOverflow(page), role).toBe(true);
      expect(real(errors), role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('沒有權限做不到：只有位置查看的帳號看得到內部欄位但按鈕全無；沒有料件查看的位置管理者「加入料件」按鈕不出現並有說明', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const part = await seedPart(partCat.id, 'E2E-權限料件');
  const loc = await seedLocation('ZT04', 'E2E-權限', { description: '內部描述-權限' });
  await seedLocationPart(loc.id, part.id, { notes: '內部備註-權限' });
  const view = await pageFor(browser, 'ga_inv_location_view', testInfo);
  try {
    await openPage(view.page);
    await openEdit(view.page, loc.name);
    await expect(sub(dialog(view.page), '位置描述')).toHaveValue('內部描述-權限');
    await expect(settingRow(view.page, part.name)).toContainText('內部備註-權限');
    await expect(dialog(view.page).getByRole('button', { name: /加入料件|儲存位置/ })).toHaveCount(0);
    await expect(view.page.getByTestId('readonly-note').locator('visible=true')).toContainText('只有查看權限');
  } finally {
    await view.ctx.close();
  }
  const edit = await pageFor(browser, 'ga_inv_location_edit', testInfo);
  try {
    await openPage(edit.page);
    await openEdit(edit.page, loc.name);
    await expect(dialog(edit.page).getByRole('button', { name: '加入料件', exact: true })).toHaveCount(0);
    await expect(dialog(edit.page)).toContainText('缺少「料件查看」權限');
    await expect(settingRow(edit.page, part.name).getByRole('button', { name: /^修改/ })).toBeVisible();
  } finally {
    await edit.ctx.close();
  }
  expect((await partState((await rowsWhere('ga_inventory_location_parts', 'location_id', loc.id))[0].id)).notes).toBe('內部備註-權限');
});
