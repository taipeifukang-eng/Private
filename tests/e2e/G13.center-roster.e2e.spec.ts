import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import {
  adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, seedTransfer, setupM7Users, type M7User,
} from '../support/m7m8-fixtures';
import { noPageOverflow, openGaCenter, pageForUser, sideLabels } from '../support/g01-ui';
import { balanceRow, invNavTo, trRow } from '../support/g12-ui';

// 2026-11-11 驗收決定 A：完全沒有角色與總務權限、只在門市名單上的督導與區經理，從全站選單進得了「總務服務中心」，
// 只看得到自己門市的庫存總覽與調撥（唯讀），側欄沒有需要總務權限的入口，也沒有任何操作按鈕。桌機 1440 與手機 390 各跑一次。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let partCat: { id: string };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupM7Users(['bare_supervisor', 'bare_area_manager']);
  users = made.users;
  teardownUsers = made.teardown;
  partCat = await seedCategory('part', 'G13R');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const searchBox = (page: any) => page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();
const stateOf = async (u: M7User) => {
  const api = await apiForUser(u as any);
  const state = await api.storageState();
  await api.dispose();
  return state;
};

test('只靠門市名單身分的督導與區經理：選單進總務中心、看自己門市庫存與調撥、沒有操作按鈕與壞入口', async ({ browser }, testInfo) => {
  test.setTimeout(480_000);
  const src = await seedLocation(null, 'R-倉');
  const mine = await seedLocation('ZT01', 'R-我的店');
  const theirs = await seedLocation('VW001', 'R-他店');
  const pm = await seedPart(partCat.id, 'R-我的料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  const pt = await seedPart(partCat.id, 'R-他店料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  for (const [l, p] of [[src, pm], [src, pt], [mine, pm], [theirs, pt]] as const) await seedLocationPart(l.id, p.id);
  await seedBalance(mine.id, pm.id, 7);
  await seedBalance(theirs.id, pt.id, 9);
  const tm = await seedTransfer(src.id, mine.id, pm.id, 'R-我的單', 'IN_TRANSIT');
  const tt = await seedTransfer(src.id, theirs.id, pt.id, 'R-他店單', 'IN_TRANSIT');
  const myReason = (await adminDb().from('ga_inventory_transfers').select('reason').eq('id', tm.id).single()).data as any;
  const theirReason = (await adminDb().from('ga_inventory_transfers').select('reason').eq('id', tt.id).single()).data as any;

  for (const key of ['bare_supervisor', 'bare_area_manager']) {
    const { ctx, page, errors } = await pageForUser(browser, await stateOf(users[key]), testInfo);
    try {
      // 全站選單有「服務中心首頁」，進得去
      await openGaCenter(page);
      // 中心首頁只列新版唯讀頁；側欄沒有需要總務權限的項目
      const labels = await sideLabels(page);
      for (const bad of ['總務需求工作台', '料件處理中心', '工單中心', '廠商資料', '水電電話網路費', '新增需求', '新增設備', '新增設施', 'Excel 匯入', '貼標複核', '料件列表', '設備分類', '公司設備型號']) {
        expect(labels.join('|'), `${key} 不該看到 ${bad}`).not.toContain(bad);
      }
      expect(await noPageOverflow(page), key).toBe(true);
      // 庫存總覽：只看到自己門市，沒有過帳按鈕
      await invNavTo(page, '庫存總覽');
      await expect(page.getByTestId('readonly-note').locator('visible=true'), key).toContainText('只會看到自己門市');
      await expect(page.getByTestId('open-post'), key).toHaveCount(0);
      await searchBox(page).fill(m7Name('R-'));
      await expect(balanceRow(page, pm.name), key).toHaveCount(1);
      await expect(balanceRow(page, pt.name), key).toHaveCount(0);
      // 調撥與收貨：只看到自己門市的單，沒有建單與動作按鈕；可回報（決定 B）但不能收貨或取消
      await invNavTo(page, '調撥與收貨');
      await expect(page.getByTestId('open-create'), key).toHaveCount(0);
      await expect(page.getByTestId('readonly-note').locator('visible=true'), key).toContainText('唯讀檢視');
      await searchBox(page).fill(myReason.reason);
      await expect(trRow(page, myReason.reason), key).toHaveCount(1);
      await searchBox(page).fill(theirReason.reason);
      await expect(trRow(page, theirReason.reason), key).toHaveCount(0);
      await searchBox(page).fill(myReason.reason);
      await trRow(page, myReason.reason).getByTestId('open-detail').click();
      const d = page.locator('dialog[open]').last();
      for (const a of ['confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived']) await expect(d.getByTestId(`act-${a}`), `${key} ${a}`).toHaveCount(0);
      expect(await noPageOverflow(page), key).toBe(true);
      expect(real(errors), key).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});
