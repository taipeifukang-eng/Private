import { describe, expect, it } from 'vitest';
import {
  categoryPath, categoryUsageText, changedUnitFields, duplicateKey, orIlike, pagingMeta, parsePaging,
  partColumns, partDeleteBlockText, rehomeDiff, stripNotes, isUuid,
} from '@/lib/workspace/general-affairs/rules';

describe('G01 搜尋條件：逗號、括號、引號不再讓查詢壞掉', () => {
  it('每個欄位都用雙引號包住值', () => {
    expect(orIlike(['name', 'brand'], '螺絲')).toBe('name.ilike."%螺絲%",brand.ilike."%螺絲%"');
  });
  it('逗號與括號留在引號內，不會被 PostgREST 當成分隔符號', () => {
    expect(orIlike(['name'], '3/4"(吋),A')).toBe('name.ilike."%3/4\\"(吋),A%"');
    expect(orIlike(['name'], 'a,b)')).toBe('name.ilike."%a,b)%"');
  });
  it('反斜線與雙引號會跳脫；空白輸入回空字串；過長會截斷', () => {
    expect(orIlike(['n'], 'x\\y')).toBe('n.ilike."%x\\\\y%"');
    expect(orIlike(['n'], '   ')).toBe('');
    expect(orIlike(['n'], 'a'.repeat(300)).length).toBeLessThan(130);
  });
});

describe('G01 分頁參數', () => {
  it('預設值、上限與下限', () => {
    expect(parsePaging(new URLSearchParams(''))).toEqual({ page: 1, pageSize: 20, from: 0, to: 19 });
    expect(parsePaging(new URLSearchParams('page=3&pageSize=10'))).toEqual({ page: 3, pageSize: 10, from: 20, to: 29 });
    expect(parsePaging(new URLSearchParams('page=-5&pageSize=9999')).pageSize).toBe(100);
    expect(parsePaging(new URLSearchParams('page=x&pageSize=0')).page).toBe(1);
    expect(parsePaging(new URLSearchParams('pageSize=900'), { pageSize: 50, max: 500 }).pageSize).toBe(500);
  });
  it('總頁數至少 1，筆數是精確的', () => {
    expect(pagingMeta(1, 20, 0)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
    expect(pagingMeta(2, 20, 41)).toEqual({ page: 2, pageSize: 20, total: 41, totalPages: 3 });
  });
});

describe('Q5 料件欄位：店長看不到內部備註', () => {
  it('只有店長身分時查詢欄位不含 notes', () => {
    expect(partColumns(false).split(',')).not.toContain('notes');
    expect(partColumns(true).split(',')).toContain('notes');
    expect(partColumns(false).split(',')).toContain('name');
  });
  it('stripNotes 只在不可看備註時移除', () => {
    expect(stripNotes({ id: 1, notes: 'x' }, false)).toEqual({ id: 1 });
    expect(stripNotes({ id: 1, notes: 'x' }, true)).toEqual({ id: 1, notes: 'x' });
  });
});

describe('Q6 料件規則', () => {
  it('單位欄位有變更才算變更（數字字串與數字視為相同）', () => {
    expect(changedUnitFields({ base_unit: '個', purchase_unit: null, purchase_to_base_rate: null }, { base_unit: '個' })).toEqual([]);
    expect(changedUnitFields({ base_unit: '個' }, { base_unit: '箱' })).toEqual(['base_unit']);
    expect(changedUnitFields({ purchase_to_base_rate: '12.0000' }, { purchase_to_base_rate: 12 })).toEqual([]);
    expect(changedUnitFields({ purchase_unit: null }, { purchase_unit: '箱', purchase_to_base_rate: 6 })).toEqual(['purchase_unit', 'purchase_to_base_rate']);
    expect(changedUnitFields({ base_unit: '個' }, { name: '新名稱' })).toEqual([]);
  });
  it('重複判斷：品牌、型號、規格三欄都有值才比', () => {
    expect(duplicateKey({ brand: 'A', model: 'B', specification: 'C' })).toEqual({ brand: 'A', model: 'B', specification: 'C' });
    expect(duplicateKey({ brand: 'A', model: 'B', specification: '' })).toBeNull();
    expect(duplicateKey({ brand: ' A ', model: 'B ', specification: ' C' })?.brand).toBe('A');
  });
  it('刪除擋下的白話說明', () => {
    expect(partDeleteBlockText({ stock_locations: 0, open_requests: 0, open_transfers: 0, open_fulfillments: 0 })).toBe('');
    expect(partDeleteBlockText({ stock_locations: 2, open_requests: 1, open_transfers: 0, open_fulfillments: 3 })).toContain('2 個位置仍有庫存');
    expect(partDeleteBlockText({ stock_locations: 0, open_requests: 1, open_transfers: 2, open_fulfillments: 0 })).toContain('需求單 1 張、調撥單 2 張');
  });
});

describe('Q4 分類', () => {
  it('路徑由上到下，並能防止循環', () => {
    const m = new Map([['a', { name: '設備', parent_id: null }], ['b', { name: '冷氣', parent_id: 'a' }], ['c', { name: '濾網', parent_id: 'b' }]]);
    expect(categoryPath('c', m)).toBe('設備 › 冷氣 › 濾網');
    const loop = new Map([['x', { name: 'X', parent_id: 'y' }], ['y', { name: 'Y', parent_id: 'x' }]]);
    expect(categoryPath('x', loop)).toBe('Y › X');
    expect(categoryPath('zzz', m)).toBe('');
  });
  it('停用只看啟用中的、刪除看全部', () => {
    const u = { children_total: 3, children_active: 0, items_total: 5, items_active: 0 };
    expect(categoryUsageText(u, 'disable')).toContain('可以停用');
    expect(categoryUsageText(u, 'delete')).toBe('底下還有 3 個子分類、5 個項目，不能刪除。');
    expect(categoryUsageText({ ...u, children_active: 1, items_active: 2 }, 'disable')).toBe('底下還有 1 個啟用中的子分類、2 個啟用中的項目，不能停用。');
    expect(categoryUsageText({ children_total: 0, children_active: 0, items_total: 0, items_active: 0 }, 'delete')).toContain('可以刪除');
  });
});

describe('Q7 設備歸戶預覽：逐台列出原值與新值', () => {
  it('標出有變動的欄位', () => {
    const d = rehomeDiff({ name: '舊冷氣', brand: 'A', model: 'M1', category_id: 'c1' }, { name: '新冷氣', brand: 'A', model: 'M2', category_id: 'c1' });
    expect(d.map((x) => [x.field, x.changed])).toEqual([['name', true], ['brand', false], ['model', true], ['category_id', false]]);
    expect(d[0]).toMatchObject({ from: '舊冷氣', to: '新冷氣', label: '名稱' });
  });
});

describe('uuid 檢查', () => {
  it('只收合法 uuid', () => {
    expect(isUuid('3f2b8c1e-5b0e-4f6a-9d3e-0a1b2c3d4e5f')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(123)).toBe(false);
  });
});
