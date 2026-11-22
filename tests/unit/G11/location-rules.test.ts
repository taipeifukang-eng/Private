import { describe, expect, it } from 'vitest';
import {
  checkStockOrder, impactSummary, isLocationFormDirty, lockedFields, locationAccess, locationLabel, maskLocation, maskSetting, resolvedIssueUnit,
  settingBlockText, validateLocationPartItems, validateLocationPartPayload, validateLocationPayload, LOCATION_LOCK_NOTE,
} from '@/lib/workspace/general-affairs/inventory-rules';
import { canBeDefault, locationPatch, validateLocationForm, emptyLocationForm, draftPayload } from '../../../vue-workspace/src/lib/ga-inventory';

// G11 位置與位置料件規則（C1、C2、C3、C12）：同一份純函式伺服端與頁面共用。
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('位置輸入驗證', () => {
  it('新增：門市類型必須有門市、其他類型不可有門市', () => {
    expect(() => validateLocationPayload({ name: 'A', location_type: 'STORE' })).toThrow('必須選擇門市');
    expect(() => validateLocationPayload({ name: 'A', location_type: 'OFFICE', store_id: U1 })).toThrow('只有「門市」類型');
    expect(validateLocationPayload({ name: ' 總倉 ', location_type: 'central_warehouse', code: ' wh-1 ' })).toMatchObject({ name: '總倉', location_type: 'CENTRAL_WAREHOUSE', code: 'WH-1', is_active: true, allow_negative_stock: false, is_default: false });
  });
  it('名稱必填且不超過 100 字；類型必須在清單內；代碼不超過 40 字', () => {
    expect(() => validateLocationPayload({ name: '  ', location_type: 'OFFICE' })).toThrow('請輸入庫存位置名稱');
    expect(() => validateLocationPayload({ name: 'x'.repeat(101), location_type: 'OFFICE' })).toThrow('100 字');
    expect(() => validateLocationPayload({ name: 'A', location_type: 'MOON' })).toThrow('類型錯誤');
    expect(() => validateLocationPayload({ name: 'A', location_type: 'OFFICE', code: 'x'.repeat(41) })).toThrow('40 字');
  });
  it('代碼空白視為沒有代碼；描述空白視為 null', () => {
    expect(validateLocationPayload({ name: 'A', location_type: 'OFFICE', code: '  ', description: ' ' })).toMatchObject({ code: null, description: null });
  });
  it('預設位置只有門市與總倉；停用位置不能是預設', () => {
    expect(() => validateLocationPayload({ name: 'A', location_type: 'OFFICE', is_default: true })).toThrow('只有「門市」與「總倉」');
    expect(validateLocationPayload({ name: 'A', location_type: 'CENTRAL_WAREHOUSE', is_default: true, is_active: false }).is_default).toBe(false);
    expect(validateLocationPayload({ is_active: false, is_default: true }, { partial: true }).is_default).toBe(false);
  });
  it('布林欄位必須是真的布林；未知欄位與系統欄位被拒絕', () => {
    expect(() => validateLocationPayload({ name: 'A', location_type: 'OFFICE', is_active: 'yes' })).toThrow('必須是「是」或「否」');
    expect(() => validateLocationPayload({ name: 'A', location_type: 'OFFICE', deleted_at: 'x' })).toThrow('不支援的欄位：deleted_at');
    expect(() => validateLocationPayload({ name: 'A', location_type: 'OFFICE', created_by: U1 })).toThrow('不支援的欄位');
    expect(() => validateLocationPayload([])).toThrow('格式錯誤');
    expect(() => validateLocationPayload(null)).toThrow('格式錯誤');
  });
  it('修改：只驗有傳的欄位；同時傳類型與門市時檢查組合', () => {
    expect(validateLocationPayload({ name: '新名' }, { partial: true })).toEqual({ name: '新名' });
    expect(() => validateLocationPayload({ name: ' ' }, { partial: true })).toThrow('請輸入庫存位置名稱');
    expect(() => validateLocationPayload({ location_type: 'STORE', store_id: null }, { partial: true })).toThrow('必須選擇門市');
    expect(() => validateLocationPayload({ location_type: 'OFFICE', store_id: U1 }, { partial: true })).toThrow('只有「門市」類型');
  });
  it('門市 id 必須是 UUID', () => {
    expect(() => validateLocationPayload({ name: 'A', location_type: 'STORE', store_id: 'abc' })).toThrow('門市格式錯誤');
  });
  it('控制欄位可由呼叫端用 extraKeys 白名單放行', () => {
    expect(validateLocationPayload({ name: 'A', location_type: 'OFFICE', replace_default: true }, { extraKeys: ['replace_default'] })).toMatchObject({ name: 'A' });
  });
});

describe('位置料件設定驗證（C1）', () => {
  it('三個數量：不可為負、不可超過 4 位小數、必須是數字；空白視為沒設定', () => {
    expect(validateLocationPartPayload({ safety_stock_qty: '', reorder_point_qty: null })).toEqual({ safety_stock_qty: null, reorder_point_qty: null });
    expect(() => validateLocationPartPayload({ safety_stock_qty: -1 })).toThrow('不可小於 0');
    expect(() => validateLocationPartPayload({ safety_stock_qty: 'abc' })).toThrow('必須是數字');
    expect(() => validateLocationPartPayload({ maximum_stock_qty: 1.23456 })).toThrow('4 位小數');
    expect(validateLocationPartPayload({ maximum_stock_qty: '12.5' }).maximum_stock_qty).toBe(12.5);
  });
  it('安全 ≤ 補貨點 ≤ 最高', () => {
    expect(() => validateLocationPartPayload({ safety_stock_qty: 5, reorder_point_qty: 3 })).toThrow('安全庫存不可大於補貨點');
    expect(() => validateLocationPartPayload({ reorder_point_qty: 9, maximum_stock_qty: 3 })).toThrow('補貨點不可大於最高庫存');
    expect(() => validateLocationPartPayload({ safety_stock_qty: 9, maximum_stock_qty: 3 })).toThrow('安全庫存不可大於最高庫存');
    expect(() => checkStockOrder(1, 2, 3)).not.toThrow();
    expect(() => checkStockOrder(null, null, 3)).not.toThrow();
  });
  it('偏好領用單位只有 BASE／PURCHASE 或空白', () => {
    expect(validateLocationPartPayload({ preferred_issue_unit_type: 'purchase' }).preferred_issue_unit_type).toBe('PURCHASE');
    expect(validateLocationPartPayload({ preferred_issue_unit_type: '' }).preferred_issue_unit_type).toBeNull();
    expect(() => validateLocationPartPayload({ preferred_issue_unit_type: 'BOX' })).toThrow('偏好領用單位類型錯誤');
  });
  it('修改時不能更換料件或位置；未知欄位被拒絕', () => {
    expect(() => validateLocationPartPayload({ part_id: U1 })).toThrow('不能更換料件或位置');
    expect(() => validateLocationPartPayload({ location_id: U1 })).toThrow('不能更換料件或位置');
    expect(() => validateLocationPartPayload({ foo: 1 })).toThrow('不支援的欄位：foo');
  });
  it('備註不超過 500 字；is_active 必須是布林', () => {
    expect(() => validateLocationPartPayload({ notes: 'x'.repeat(501) })).toThrow('500 字');
    expect(() => validateLocationPartPayload({ is_active: 1 })).toThrow('必須是「是」或「否」');
  });
});

describe('批次新增（C1）', () => {
  it('每筆都驗證、同批不可重複料件、最多 100 筆、錯誤帶第 N 筆', () => {
    expect(() => validateLocationPartItems([])).toThrow('請選擇要加入的料件');
    expect(() => validateLocationPartItems('x')).toThrow('請選擇要加入的料件');
    expect(() => validateLocationPartItems([{ part_id: U1 }, { part_id: U1 }])).toThrow('第 2 筆：同一批裡重複選了這個料件');
    expect(() => validateLocationPartItems([{ part_id: U1 }, { part_id: 'bad' }])).toThrow('第 2 筆：料件格式錯誤');
    expect(() => validateLocationPartItems([{ part_id: U1, safety_stock_qty: 9, reorder_point_qty: 1 }])).toThrow('第 1 筆：安全庫存不可大於補貨點');
    const many = Array.from({ length: 101 }, (_, i) => ({ part_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    expect(() => validateLocationPartItems(many)).toThrow('一次最多加入 100 個料件');
    expect(validateLocationPartItems([{ part_id: U1, safety_stock_qty: '1' }, { part_id: U2 }])).toHaveLength(2);
  });
  it('頁面草稿轉 API 欄位：空白轉 null、數字保留字串交給伺服端驗證', () => {
    expect(draftPayload({ part_id: U1, name: 'x', safety: ' 2 ', reorder: '', maximum: '9', unit: '', notes: ' ' })).toEqual({ part_id: U1, safety_stock_qty: '2', reorder_point_qty: null, maximum_stock_qty: '9', preferred_issue_unit_type: null, notes: null });
  });
});

describe('停用與刪除前的影響說明（C2）', () => {
  const base = { stock_items: 0, transactions: 0, open_transfers: 0, open_transfer_nos: [] as string[], location_parts: 3, has_history: false };
  it('什麼都沒有：可以直接停用或刪除', () => {
    for (const a of ['disable', 'delete'] as const) {
      const s = impactSummary(base, a);
      expect(s.blocked).toBe('');
      expect(s.warn).toBe('');
      expect(s.text).toContain('3 筆料件設定');
    }
  });
  it('有進行中調撥：一律擋（停用與刪除都是），訊息列出單號', () => {
    const i = { ...base, open_transfers: 2, open_transfer_nos: ['GAT-1', 'GAT-2'], stock_items: 5 };
    expect(impactSummary(i, 'disable').blocked).toContain('2 張進行中的調撥單');
    expect(impactSummary(i, 'disable').blocked).toContain('GAT-1、GAT-2');
    expect(impactSummary(i, 'delete').blocked).toContain('請先完成或取消調撥單再刪除');
  });
  it('只有庫存：停用要確認（warn）、刪除直接擋', () => {
    const i = { ...base, stock_items: 4 };
    expect(impactSummary(i, 'disable')).toMatchObject({ blocked: '', warn: expect.stringContaining('4 項庫存') });
    expect(impactSummary(i, 'delete').blocked).toContain('不能刪除');
  });
  it('設定的移除與停用阻擋說明：庫存優先、其次進行中調撥', () => {
    expect(settingBlockText({ has_stock: true, stock_qty: 7 }, 'remove')).toContain('不能移除設定');
    expect(settingBlockText({ has_stock: false, open_transfers: 1, open_transfer_nos: ['GAT-9'] }, 'disable')).toContain('GAT-9');
    expect(settingBlockText({}, 'remove')).toBe('');
  });
});

describe('鎖定（C3）', () => {
  it('有交易或庫存：類型、門市、代碼鎖定；沒有就不鎖', () => {
    expect(lockedFields(true)).toEqual(['location_type', 'store_id', 'code']);
    expect(lockedFields(false)).toEqual([]);
    expect(LOCATION_LOCK_NOTE).toContain('要換店請新增位置');
  });
});

describe('可見範圍與內部欄位遮蔽（C12）', () => {
  it('位置查看／管理：看得到內部欄位；只有門市名單：唯讀且遮蔽；都沒有：不能讀', () => {
    expect(locationAccess({ canView: true, canManage: false, roster: false })).toMatchObject({ read: true, internal: true, manage: false, readOnly: true });
    expect(locationAccess({ canView: true, canManage: true, roster: true })).toMatchObject({ read: true, internal: true, manage: true, readOnly: false });
    expect(locationAccess({ canView: false, canManage: false, roster: true })).toMatchObject({ read: true, internal: false, manage: false, readOnly: true });
    expect(locationAccess({ canView: false, canManage: false, roster: false }).read).toBe(false);
  });
  it('遮蔽位置描述與設定備註，其他欄位不動', () => {
    const loc = { id: 'a', name: 'N', description: '內部' };
    expect(maskLocation(loc, false)).toEqual({ id: 'a', name: 'N' });
    expect(maskLocation(loc, true)).toBe(loc);
    const set = { id: 'b', notes: '內部備註', is_active: true };
    expect(maskSetting(set, false)).toEqual({ id: 'b', is_active: true });
    expect(maskSetting(set, true)).toBe(set);
  });
});

describe('其他小工具', () => {
  it('名稱標示與偏好單位解析', () => {
    expect(locationLabel({ name: '總倉', code: 'WH' })).toBe('總倉（WH）');
    expect(locationLabel({ name: '總倉', code: null })).toBe('總倉');
    expect(resolvedIssueUnit('BASE', { base_unit: '個', purchase_unit: '箱' })).toBe('個');
    expect(resolvedIssueUnit('PURCHASE', { base_unit: '個', purchase_unit: '箱' })).toBe('箱');
    expect(resolvedIssueUnit(null, { base_unit: '個' })).toBeNull();
    expect(resolvedIssueUnit('BASE', null)).toBeNull();
  });
  it('表單是否有未存變更：忽略前後空白', () => {
    const a = { code: 'A', name: '倉', location_type: 'OFFICE', store_id: '', description: '', is_active: true, allow_negative_stock: false, is_default: false };
    expect(isLocationFormDirty(a, { ...a, name: ' 倉 ' })).toBe(false);
    expect(isLocationFormDirty(a, { ...a, name: '倉2' })).toBe(true);
    expect(isLocationFormDirty(a, { ...a, allow_negative_stock: true })).toBe(true);
  });
  it('頁面表單驗證與只送變更欄位', () => {
    expect(validateLocationForm({ ...emptyLocationForm(), name: '' })).toMatchObject({ name: '請輸入位置名稱', store_id: '「門市」類型必須選擇門市' });
    expect(validateLocationForm({ ...emptyLocationForm(), name: 'A', location_type: 'OFFICE' })).toEqual({});
    const init = { ...emptyLocationForm(), name: 'A', location_type: 'STORE', store_id: U1, code: 'X' };
    expect(locationPatch(init, { ...init })).toEqual({});
    expect(locationPatch(init, { ...init, name: 'B', code: '' })).toEqual({ name: 'B', code: null });
    expect(locationPatch(init, { ...init, location_type: 'OFFICE', store_id: '' })).toEqual({ location_type: 'OFFICE', store_id: null });
    expect(canBeDefault({ location_type: 'STORE', is_active: true })).toBe(true);
    expect(canBeDefault({ location_type: 'OFFICE', is_active: true })).toBe(false);
    expect(canBeDefault({ location_type: 'STORE', is_active: false })).toBe(false);
  });
});
