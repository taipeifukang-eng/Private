import { describe, expect, it } from 'vitest';
import {
  addDays, BASIC_COLUMNS, diffAssetPatch, FULL_ONLY_KEYS, pickAssetFields, taipeiToday, warrantyInput, warrantyRanges, warrantyState,
} from '@/lib/workspace/general-affairs/asset-fields';
import { emptyEquipmentForm, equipmentCreatePayload, equipmentFormFromRow, equipmentPatch, validateEquipmentForm } from '../../../vue-workspace/src/lib/ga-assets';

const equipment = {
  id: 'e1', store_id: 's1', category_id: 'c1', template_id: 't1', name: '冷氣', asset_code: 'IC01202611100001', barcode: 'B1', brand: 'Daikin', model: 'X1', serial_number: 'SN-1',
  status: 'ACTIVE', criticality: 'HIGH', area: '賣場', location_detail: '收銀台旁', purpose: '降溫', installed_at: '2026-01-01', purchased_at: '2026-01-01', activated_at: null,
  purchase_amount: 12345, specs: { purchase_source_supplier: '某供應商', warranty_claim_method: 'ONLINE_REGISTRATION' }, tags: ['a'], notes: '內部備註', has_warranty: true,
  warranty_end_date: '2027-01-01', qr_token: 'abcdefghijklmnopqrstuvwx', onboarding_status: 'COMPLETED', updated_at: '2026-11-10T00:00:00+00:00',
  store: { id: 's1', store_code: 'VW001', store_name: '測試店' }, category: { id: 'c1', name: '空調', code: 'IC' }, template: { id: 't1', name: 'T' },
};

describe('Q5 欄位挑選：店長只看基本欄位', () => {
  it('basic 層級不含金額、供應商、備註、序號、條碼、採購日、QR、specs', () => {
    const out = pickAssetFields('equipment', equipment, 'basic');
    for (const k of FULL_ONLY_KEYS.equipment) expect(out, k).not.toHaveProperty(k);
    expect(out).toMatchObject({ name: '冷氣', status: 'ACTIVE', area: '賣場', location_detail: '收銀台旁', has_warranty: true, warranty_end_date: '2027-01-01' });
    expect(out.store.store_code).toBe('VW001');
    expect(JSON.stringify(out)).not.toMatch(/12345|某供應商|內部備註|SN-1|abcdefghijklmnopqrstuvwx/);
  });
  it('full 層級保留全部欄位並加上保固狀態與 QR 掃描路徑', () => {
    const out = pickAssetFields('equipment', equipment, 'full');
    expect(out.purchase_amount).toBe(12345);
    expect(out.warranty.state).toBeTruthy();
    expect(out.qr_scan_path).toBe('/general-affairs/assets/scan/abcdefghijklmnopqrstuvwx');
  });
  it('設施 basic：保固從 specs 取出，其餘 specs 內容（保固申請方式等）不外露', () => {
    const fac = { id: 'f1', store_id: 's1', name: '貨架', facility_code: 'F1', status: 'ACTIVE', area: 'A', location_detail: 'B', specs: { facility_has_warranty: true, facility_warranty_end_date: '2027-05-05', facility_warranty_claim_method: 'OTHER', secret: 'x' }, purchase_amount: 999, notes: 'n', onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', updated_at: 'u' };
    const out = pickAssetFields('facilities', fac, 'basic');
    expect(out).toMatchObject({ has_warranty: true, warranty_end_date: '2027-05-05' });
    expect(out).not.toHaveProperty('specs');
    expect(JSON.stringify(out)).not.toMatch(/999|secret|claim/);
    for (const k of FULL_ONLY_KEYS.facilities) expect(out, k).not.toHaveProperty(k);
  });
  it('基本欄位清單不含任何完整層級專屬欄位', () => {
    for (const kind of ['equipment', 'facilities'] as const) {
      const bad = BASIC_COLUMNS[kind].filter((c) => (FULL_ONLY_KEYS[kind] as readonly string[]).includes(c) && c !== 'specs');
      expect(bad).toEqual([]);
    }
  });
});

describe('保固：台北時間，到期日當天結束才過期', () => {
  const at = (iso: string) => new Date(iso);
  it('台北今天的日期：UTC 前一天 16:00 之後已經是台北隔天', () => {
    expect(taipeiToday(at('2026-11-10T15:59:59Z'))).toBe('2026-11-10');
    expect(taipeiToday(at('2026-11-10T16:00:00Z'))).toBe('2026-11-11');
  });
  it('到期日當天（台北）仍在保固內，隔天才過期（舊版用 UTC 時間差，當天就被判過保）', () => {
    const w = { has_warranty: true, end_date: '2026-11-10' };
    expect(warrantyState(w, at('2026-11-10T15:59:59Z')).state).toBe('expiring'); // 台北 11/10 23:59:59
    expect(warrantyState(w, at('2026-11-10T15:59:59Z')).label).toBe('今天到期');
    expect(warrantyState(w, at('2026-11-10T16:00:00Z')).state).toBe('expired'); // 台北 11/11 00:00:00
    expect(warrantyState(w, at('2026-11-10T16:00:00Z')).label).toBe('已過保');
  });
  it('即將到期門檻 30 天（含）、保固中、無保固、保固日未填', () => {
    const now = at('2026-11-10T04:00:00Z');
    expect(warrantyState({ has_warranty: true, end_date: '2026-12-10' }, now)).toMatchObject({ state: 'expiring', days_left: 30 });
    expect(warrantyState({ has_warranty: true, end_date: '2026-12-11' }, now)).toMatchObject({ state: 'active', days_left: 31 });
    expect(warrantyState({ has_warranty: false, end_date: '2030-01-01' }, now).state).toBe('none');
    expect(warrantyState({ has_warranty: true, end_date: null }, now).state).toBe('missing');
  });
  it('日期加減與篩選區間', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(warrantyRanges(at('2026-11-10T04:00:00Z'))).toEqual({ today: '2026-11-10', expiringEnd: '2026-12-10' });
    expect(warrantyInput('facilities', { specs: { facility_has_warranty: true, facility_warranty_end_date: '2027-01-01' } })).toEqual({ has_warranty: true, end_date: '2027-01-01' });
  });
});

describe('編輯只更新有改的欄位（修正清空供應商與保固申請方式的舊 bug）', () => {
  it('沒改的欄位不送；specs 合併保留未提到的鍵', () => {
    const out = diffAssetPatch(equipment, { name: '冷氣', brand: 'Daikin', specs: { purchase_source_supplier: '某供應商' } });
    expect(out).toEqual({});
  });
  it('只送 specs: {} 不會清掉既有鍵（舊版會清空）', () => {
    expect(diffAssetPatch(equipment, { specs: {} })).toEqual({});
  });
  it('明確送 null 才清空該鍵，其他鍵保留', () => {
    const out = diffAssetPatch(equipment, { specs: { purchase_source_supplier: null } });
    expect(out.specs).toEqual({ purchase_source_supplier: null, warranty_claim_method: 'ONLINE_REGISTRATION' });
  });
  it('數字與字串等價（金額 12345 與 "12345"）視為沒改', () => {
    expect(diffAssetPatch(equipment, { purchase_amount: '12345' })).toEqual({});
    expect(diffAssetPatch(equipment, { purchase_amount: 20000 })).toEqual({ purchase_amount: 20000 });
  });
  it('前端表單 diff：只改名稱時只送 name；改保固申請方式時 specs 只帶該鍵', () => {
    const before = equipmentFormFromRow(equipment);
    expect(equipmentPatch(before, { ...before, name: '新名稱' })).toEqual({ name: '新名稱' });
    const p = equipmentPatch(before, { ...before, warranty_claim_method: 'OTHER', warranty_claim_notes: '電話' });
    expect(p.specs).toEqual({ warranty_claim_method: 'OTHER', warranty_claim_notes: '電話' });
    expect(p).not.toHaveProperty('name');
    // 清空供應商是明確動作，送 null
    expect(equipmentPatch(before, { ...before, purchase_source_supplier: '' }).specs).toEqual({ purchase_source_supplier: null });
  });
  it('取消「有保固」時一併清掉到期日', () => {
    const before = equipmentFormFromRow(equipment);
    expect(equipmentPatch(before, { ...before, has_warranty: false })).toMatchObject({ has_warranty: false, warranty_end_date: null });
  });
});

describe('新增設備表單驗證與內容', () => {
  it('必填、數量 1 到 100、多台不可指定同一個資產編號', () => {
    const f = emptyEquipmentForm();
    expect(validateEquipmentForm(f, { needStore: true, storeId: '', quantity: 1 })).toMatchObject({ store_id: expect.any(String), category_id: expect.any(String), name: expect.any(String) });
    const ok = { ...f, category_id: 'c', name: 'n' };
    expect(validateEquipmentForm(ok, { needStore: true, storeId: 's', quantity: 1 })).toEqual({});
    expect(validateEquipmentForm(ok, { needStore: true, storeId: 's', quantity: 0 }).quantity).toBeTruthy();
    expect(validateEquipmentForm(ok, { needStore: true, storeId: 's', quantity: 101 }).quantity).toBeTruthy();
    expect(validateEquipmentForm(ok, { needStore: true, storeId: 's', quantity: 1.5 }).quantity).toBeTruthy();
    expect(validateEquipmentForm({ ...ok, asset_code: 'X' }, { needStore: true, storeId: 's', quantity: 2 }).asset_code).toBeTruthy();
    expect(validateEquipmentForm({ ...ok, has_warranty: true, purchased_at: '2026-02-01', warranty_end_date: '2026-01-01' }, {}).warranty_end_date).toBeTruthy();
  });
  it('建立內容：無保固時不送到期日；specs 帶供應商與保固申請方式', () => {
    const f = { ...emptyEquipmentForm(), category_id: 'c', name: ' 冷氣 ', has_warranty: false, warranty_end_date: '2027-01-01', purchase_source_supplier: '原廠', warranty_claim_method: 'OTHER', warranty_claim_notes: '電話' };
    const p = equipmentCreatePayload(f, 's1', 3, 'NEW_PURCHASE');
    expect(p).toMatchObject({ store_id: 's1', quantity: 3, name: '冷氣', has_warranty: false, warranty_end_date: null });
    expect(p.specs).toEqual({ entry_mode: 'NEW_PURCHASE', purchase_source_supplier: '原廠', warranty_claim_method: 'OTHER', warranty_claim_notes: '電話' });
  });
});
