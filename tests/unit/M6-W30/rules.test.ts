import { describe, expect, it } from 'vitest';
import { canSeeClinicSelfpayMenu, CLINIC_PERM, isManagerJobTitle, isStoreScopedJobTitle, resolveAccess, seesAllStores } from '../../../lib/clinic-selfpay/access';
import { buildClaimItems, buildPriceMap, findUnmatched, noPriceMessage, periodMismatch, periodMismatchMessage, roundSummary, roundTo1, summarize, unmatchedMessage } from '../../../lib/clinic-selfpay/margin';
import { extractItems } from '../../../lib/clinic-selfpay/claim-parser';
import { readClaimRows } from '../../../lib/clinic-selfpay/files';
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, screenshotExt, validateScreenshots } from '../../../lib/clinic-selfpay/screenshots';
import { clinicFixture, PRICES_2038_11 } from '../../support/clinic-selfpay-fixtures';
import { legacyAccess, legacyLib } from '../../support/legacy-clinic-selfpay';

const legacyLibFns = legacyLib();
const ALL_PERMS = Object.values(CLINIC_PERM);
const TITLES = ['', null, '店長', '代理店長', '督導', '督導(代理店長)', '經理', '副理', '區經理', '營業經理', '區域經理', '門市經理', '資深經理人', '藥師', '店員', ' 店長 ', '測試'];

describe('D1 resolveAccess：與舊版 getClinicSelfpayAccess 逐組合相同', () => {
  // 4 個專屬權限的所有子集合 x 各種職稱，全部和舊版原始碼（以假資料庫載入）比對
  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << ALL_PERMS.length; mask += 1) subsets.push(ALL_PERMS.filter((_, i) => mask & (1 << i)));
  it(`${subsets.length} 種權限組合 x ${TITLES.length} 種職稱`, async () => {
    for (const perms of subsets) {
      for (const title of TITLES) {
        const expected = await legacyAccess(perms, title);
        expect(resolveAccess(perms, title), `${perms.join('+') || '無'} / ${title}`).toEqual(expected);
        expect(resolveAccess((...codes: string[]) => codes.some((c) => perms.includes(c)), title)).toEqual(expected);
      }
    }
  });
  it('職稱判斷函式與舊版相同', () => {
    for (const t of TITLES) {
      expect(isStoreScopedJobTitle(t)).toBe(legacyLibFns.isStoreScopedJobTitle(t));
      expect(isManagerJobTitle(t)).toBe(legacyLibFns.isManagerJobTitle(t));
    }
  });
  it('各權限的語意：margin 全開（刪批次除外）、calculator 只能用計算器、mapping 只管主檔、batch.delete 只能刪', () => {
    expect(resolveAccess([CLINIC_PERM.margin], '')).toEqual({ canUseCalculator: true, canManageMapping: true, canDeleteBatch: false });
    expect(resolveAccess([CLINIC_PERM.calculator], '')).toEqual({ canUseCalculator: true, canManageMapping: false, canDeleteBatch: false });
    expect(resolveAccess([CLINIC_PERM.mapping], '')).toEqual({ canUseCalculator: false, canManageMapping: true, canDeleteBatch: false });
    expect(resolveAccess([CLINIC_PERM.batchDelete], '')).toEqual({ canUseCalculator: false, canManageMapping: false, canDeleteBatch: true });
    expect(resolveAccess([], '店長')).toEqual({ canUseCalculator: true, canManageMapping: false, canDeleteBatch: false });
    expect(resolveAccess([], '區經理')).toEqual({ canUseCalculator: true, canManageMapping: true, canDeleteBatch: true });
    expect(resolveAccess([], '藥師')).toEqual({ canUseCalculator: false, canManageMapping: false, canDeleteBatch: false });
  });
  it('D1 選單可見 = 能用計算器或能管理主檔（看得到就一定能用）；舊 Navbar 的月報權限碼不再決定可見', () => {
    for (const perms of subsets) {
      for (const title of TITLES) {
        const a = resolveAccess(perms, title);
        expect(canSeeClinicSelfpayMenu(a)).toBe(a.canUseCalculator || a.canManageMapping);
      }
    }
    // 舊 Navbar 條件的四個碼，單獨持有時不再看得到
    for (const code of ['monthly.status.view_own', 'monthly.status.view_all', 'employee.movement.manage', 'store.manage']) {
      expect(canSeeClinicSelfpayMenu(resolveAccess([code], '')), code).toBe(false);
    }
    expect(canSeeClinicSelfpayMenu(resolveAccess([CLINIC_PERM.mapping], ''))).toBe(true);
    expect(canSeeClinicSelfpayMenu(resolveAccess([CLINIC_PERM.batchDelete], ''))).toBe(false); // 只有刪批次碼進不了頁面（舊版 API 也一樣）
  });
  it('門市範圍分流：admin 且職稱不是門市型才看全部', () => {
    expect(seesAllStores('admin', '')).toBe(true);
    expect(seesAllStores('admin', '店長')).toBe(false);
    expect(seesAllStores('member', '經理')).toBe(false);
    expect(seesAllStores(null, null)).toBe(false);
  });
});

describe('毛利計算與提示文字', () => {
  const priceRows = PRICES_2038_11.map((p, i) => ({ id: `P${i}`, health_insurance_code: p.code, product_code: p.product, member_price: String(p.member), cost_price: p.cost }));
  const items = extractItems(readClaimRows(clinicFixture('claim-basic.xlsx')).rows).items;
  const map = buildPriceMap(priceRows);
  it('單列金額取小數 2 位、批次合計取小數 1 位；快照欄位帶入當下的價格', () => {
    const rows = buildClaimItems(items, map);
    // ZTA000002：會員價 250.5、成本 180.25、數量 3 -> 751.5 / 210.75
    const r = rows[1];
    expect([r.billing_amount, r.gross_profit_amount, r.matched_member_price, r.matched_cost_price, r.matched_product_code, r.matched_price_entry_id]).toEqual([751.5, 210.75, 250.5, 180.25, '00012346', 'P1']);
    expect(rows.every((x) => x.match_status === 'matched')).toBe(true);
    const sum = summarize(rows);
    expect(sum.itemCount).toBe(8);
    expect(sum.totalQty).toBeCloseTo(10 + 3 + 5 + 2 + 4 + 1200 + 3 + 1.5, 10);
    const rounded = roundSummary(sum);
    expect(rounded.totalBilling).toBe(roundTo1(rows.reduce((a, x) => a + x.billing_amount, 0)));
    expect(Number.isInteger(rounded.totalBilling * 10)).toBe(true);
  });
  it('0.1 的浮點誤差：單列 toFixed(2)、合計 roundTo1 不會出現 0.30000000000000004', () => {
    const rows = buildClaimItems([{ lineNo: 1, healthInsuranceCode: 'ZTA000001', drugName: 'x', qty: 3 }], buildPriceMap([{ id: 'a', health_insurance_code: 'ZTA000001', member_price: 0.1, cost_price: 0 }]));
    expect(rows[0].billing_amount).toBe(0.3);
    expect(roundSummary(summarize(rows)).totalBilling).toBe(0.3);
  });
  it('D2 未匹配：同代碼同藥名只列一次、順序為第一次出現；訊息格式與舊版相同', () => {
    const parsed = extractItems(readClaimRows(clinicFixture('claim-unmatched.xlsx')).rows).items;
    const un = findUnmatched(parsed, map);
    expect(un).toEqual([{ code: 'ZTU000001', name: '測試未匹配藥甲' }, { code: 'ZTU000002', name: '測試未匹配藥乙' }]);
    expect(unmatchedMessage(un)).toBe('尚未有DPOS商品資訊，請將此訊息之藥品內容複製給營業部匯入DPOS商品主檔資訊\n健保代碼ZTU000001 藥品名稱:測試未匹配藥甲\n健保代碼ZTU000002 藥品名稱:測試未匹配藥乙');
    expect(noPriceMessage('2038-11')).toBe('尚未有11月成本、會員價的月度紀錄請聯繫營業部匯入');
  });
  it('D3 期間不一致提示：檔案是 X 月，與你選的 Y 月不同，確定嗎？（跨年加年份）', () => {
    expect(periodMismatch('2038-10', '2038-11')).toBe(true);
    expect(periodMismatch('2038-11', '2038-11')).toBe(false);
    expect(periodMismatch(null, '2038-11')).toBe(false);
    expect(periodMismatchMessage('2038-10', '2038-11')).toBe('檔案是 10 月，與你選的 11 月不同，確定嗎？');
    expect(periodMismatchMessage('2037-12', '2038-01')).toBe('檔案是 2037 年 12 月，與你選的 2038 年 1 月不同，確定嗎？');
  });
});

describe('D6 截圖規則', () => {
  const ok = { name: 'a.png', type: 'image/png', size: 1000 };
  it('至少 1 張、最多 10 張、每張 5MB 內、只收 png/jpeg/webp', () => {
    expect(validateScreenshots([])).toMatch(/至少上傳 1 張/);
    expect(validateScreenshots([{ ...ok, size: 0 }])).toMatch(/至少上傳 1 張/);
    expect(validateScreenshots([ok])).toBeNull();
    expect(validateScreenshots(Array.from({ length: SCREENSHOT_MAX_COUNT }, () => ok))).toBeNull();
    expect(validateScreenshots(Array.from({ length: SCREENSHOT_MAX_COUNT + 1 }, () => ok))).toMatch(/最多上傳 10 張/);
    expect(validateScreenshots([{ ...ok, size: SCREENSHOT_MAX_BYTES }])).toBeNull();
    expect(validateScreenshots([{ ...ok, size: SCREENSHOT_MAX_BYTES + 1 }])).toMatch(/5MB/);
    for (const type of ['image/gif', 'application/pdf', 'image/svg+xml', '', undefined]) expect(validateScreenshots([{ ...ok, type }]), String(type)).toMatch(/png、jpeg、webp/);
    for (const type of ['image/jpeg', 'image/webp']) expect(validateScreenshots([{ ...ok, type }])).toBeNull();
  });
  it('副檔名依檔案類型決定，不採用使用者檔名', () => {
    expect([screenshotExt('image/png'), screenshotExt('image/webp'), screenshotExt('image/jpeg'), screenshotExt(undefined)]).toEqual(['png', 'webp', 'jpg', 'jpg']);
  });
});
