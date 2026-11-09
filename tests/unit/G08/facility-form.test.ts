import { describe, expect, it } from 'vitest';
import {
  emptyFacilityForm, facilityCreatePayload, facilityFormFromRow, facilityPatch, validateFacilityForm, warrantyMonths,
} from '../../../vue-workspace/src/lib/ga-assets';

// G08 設施表單：欄位轉換、只送有改的欄位（specs 合併）、驗證規則（沿用舊版新增頁）。
const base = () => ({ ...emptyFacilityForm(), facility_template_id: 't1', category_id: 'c1', name: '中島架', area: '前場營業區', location_detail: '入口右側', quantity: '2', unit: '座' });

describe('新增 payload 與舊版新增頁相同', () => {
  it('品牌、型號、位置補充、保固都放在 specs；購買總額 = 數量 x 每單位金額', () => {
    const f = { ...base(), brand: 'B', model: 'M', floor_area_description: '二樓', purchase_unit_amount: '1500', has_warranty: true, warranty_start_date: '2026-01-01', warranty_end_date: '2027-01-01', warranty_claim_method: 'OTHER', warranty_claim_notes: ' 找供應商 ' };
    const p = facilityCreatePayload(f, 'store-1', 'NEW_PURCHASE') as any;
    expect(p).toMatchObject({ store_id: 'store-1', quantity: 2, unit: '座', is_fixed_asset: true, purchase_unit_amount: 1500, purchase_amount: 3000 });
    expect(p.specs).toEqual({
      entry_mode: 'NEW_PURCHASE', facility_brand: 'B', facility_model: 'M', facility_floor_area_description: '二樓', facility_has_warranty: true,
      facility_warranty_start_date: '2026-01-01', facility_warranty_end_date: '2027-01-01', facility_warranty_claim_method: 'OTHER', facility_warranty_description: null, facility_warranty_claim_notes: '找供應商',
    });
  });
  it('沒有保固時保固欄位全部清空；其他方式以外不留備註', () => {
    const p = facilityCreatePayload({ ...base(), has_warranty: false, warranty_end_date: '2027-01-01', warranty_claim_notes: 'x' }, 's', 'EXISTING_ASSET') as any;
    expect(p.specs).toMatchObject({ facility_has_warranty: false, facility_warranty_end_date: null, facility_warranty_claim_method: null, facility_warranty_claim_notes: null });
  });
});

describe('編輯只送有改的欄位', () => {
  const row = {
    facility_template_id: 't1', category_id: 'c1', name: 'A', facility_code: 'F1', status: 'ACTIVE', criticality: 'NORMAL', area: '收銀區', location_detail: 'x', quantity: 2, unit: '座',
    purchase_unit_amount: 100, purchase_amount: 200, specs: { facility_brand: '原牌', facility_has_warranty: true, facility_warranty_end_date: '2027-01-01', other_key: 1 },
  };
  it('沒改任何欄位 → 空 patch', () => {
    const f = facilityFormFromRow(row);
    expect(facilityPatch(f, { ...f })).toEqual({});
  });
  it('只改名稱 → 只有 name；specs 不送', () => {
    const f = facilityFormFromRow(row);
    expect(facilityPatch(f, { ...f, name: ' B ' })).toEqual({ name: 'B' });
  });
  it('改保固到期日 → specs 只含保固鍵（由伺服端合併，品牌等其他鍵保留）', () => {
    const f = facilityFormFromRow(row);
    const p = facilityPatch(f, { ...f, warranty_end_date: '2028-01-01' }) as any;
    expect(Object.keys(p)).toEqual(['specs']);
    expect(p.specs.facility_warranty_end_date).toBe('2028-01-01');
    expect(p.specs).not.toHaveProperty('facility_brand');
  });
  it('改數量會同步重算購買總額；清空日期送 null；編輯畫面不會送 store_id', () => {
    const f = facilityFormFromRow({ ...row, installed_at: '2026-01-01' });
    const p = facilityPatch(f, { ...f, quantity: '3', installed_at: '' }) as any;
    expect(p).toMatchObject({ quantity: 3, purchase_amount: 300, installed_at: null });
    expect(p).not.toHaveProperty('store_id');
  });
});

describe('驗證', () => {
  it('新增：必須選建檔方式與架型、區域與位置、數量與單位', () => {
    const e = validateFacilityForm(emptyFacilityForm(), { create: true, needStore: true, storeId: '' });
    expect(Object.keys(e).sort()).toEqual(['area', 'category_id', 'entry_mode', 'facility_template_id', 'location_detail', 'name', 'store_id']);
    expect(validateFacilityForm({ ...base(), unit: '' }, { create: true, needStore: true, storeId: 's', entryMode: 'EXISTING_ASSET' })).toEqual({ unit: '請輸入設施單位' });
  });
  it('新購一定要有購買日期；有保固要起訖日且起不能晚於迄', () => {
    const f = { ...base(), has_warranty: true, warranty_start_date: '2027-02-01', warranty_end_date: '2027-01-01' };
    const e = validateFacilityForm(f, { create: true, needStore: true, storeId: 's', entryMode: 'NEW_PURCHASE' });
    expect(e.purchased_at).toBeTruthy();
    expect(e.warranty_start_date).toMatch(/不可晚於/);
    expect(e.warranty_end_date).toMatch(/不可早於/);
  });
  it('編輯：舊資料沒有數量與單位（舊版允許）不擋；只填一半才擋', () => {
    expect(validateFacilityForm({ ...base(), quantity: '', unit: '' })).toEqual({});
    expect(validateFacilityForm({ ...base(), quantity: '', unit: '座' }).quantity).toBeTruthy();
  });
});

describe('保固月數', () => {
  it('起訖日期算約幾個月；起日晚於迄日或缺日期為 null', () => {
    expect(warrantyMonths('2026-01-01', '2027-01-01')).toBe(13);
    expect(warrantyMonths('2027-01-02', '2027-01-01')).toBeNull();
    expect(warrantyMonths('', '2027-01-01')).toBeNull();
  });
});
