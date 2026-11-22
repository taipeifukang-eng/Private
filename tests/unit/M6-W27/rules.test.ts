import { describe, expect, it } from 'vitest';
import {
  chunk,
  cleanSearch,
  escapeLike,
  IMPORT_ALIASES,
  IMPORT_BATCH_SIZE,
  mergeSearch,
  orContains,
  normalizeExcelRow,
  planImport,
  sanitizeInputs,
  type ExistingProduct,
} from '../../../lib/products-master/rules';

// 舊 app/api/products-master/route.ts 的 normalize（逐字抄來，作為欄位別名的對照基準）
const legacyNormalize = (row: any, keys: string[]): string => {
  for (const k of keys) {
    const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
  }
  return '';
};
const legacyRecord = (row: any) => ({
  product_code: legacyNormalize(row, ['商品編號', 'product_code', 'ProductCode', '編號']),
  product_name: legacyNormalize(row, ['商品名稱', 'product_name', 'ProductName', '品名', '名稱']),
  unit: legacyNormalize(row, ['單位', 'unit', 'Unit']) || '',
});

describe('M6-W27/W28 欄位別名：與舊版 normalize 逐列一致', () => {
  const samples: Record<string, unknown>[] = [
    { 商品編號: 'A001', 商品名稱: '感冒糖漿', 單位: '瓶' },
    { 編號: ' 00123 ', 品名: '維他命C', unit: '條' },
    { product_code: 'p-1', product_name: 'N', Unit: 'ea' },
    { ProductCode: 'X9', ProductName: '名稱X' },
    { 商品編號: '', 編號: 'B2', 名稱: '次要別名', 單位: '' },
    { 商品編號: 123, 商品名稱: 456, 單位: 7 },
    { 其他欄位: 'zzz' },
    { PRODUCT_CODE: 'UP', PRODUCT_NAME: 'UPPER', UNIT: 'U' },
  ];
  it('別名清單沿用舊版', () => {
    expect([...IMPORT_ALIASES.code]).toEqual(['商品編號', 'product_code', 'ProductCode', '編號']);
    expect([...IMPORT_ALIASES.name]).toEqual(['商品名稱', 'product_name', 'ProductName', '品名', '名稱']);
    expect([...IMPORT_ALIASES.unit]).toEqual(['單位', 'unit', 'Unit']);
  });
  for (const [i, row] of samples.entries())
    it(`樣本 ${i + 1}`, () => {
      const n = normalizeExcelRow(row);
      expect({ product_code: n.code, product_name: n.name, unit: n.unit }).toEqual(legacyRecord(row));
    });
});

describe('搜尋', () => {
  it('跳脫 LIKE 特殊字元，逗號括號不改寫', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeLike('a,b)(c')).toBe('a,b)(c');
  });
  it('orContains：值整個用雙引號包起來，逗號括號引號反斜線不會改寫 or() 條件', () => {
    expect(orContains('abc')).toBe('product_code.ilike."%abc%",product_name.ilike."%abc%"');
    expect(orContains(escapeLike('x,y.z%'))).toBe('product_code.ilike."%x,y.z\\\\%%",product_name.ilike."%x,y.z\\\\%%"');
    expect(orContains('a"b)(c')).toBe('product_code.ilike."%a\\"b)(c%",product_name.ilike."%a\\"b)(c%"');
  });
  it('去前後空白並限制長度', () => {
    expect(cleanSearch('  ab ')).toBe('ab');
    expect(cleanSearch(null)).toBe('');
    expect(cleanSearch('x'.repeat(300))).toHaveLength(100);
  });
  it('編號開頭優先、再補包含、最多 20、同編號不重複', () => {
    const prefix = Array.from({ length: 15 }, (_, i) => ({ product_code: `A${String(i).padStart(2, '0')}` }));
    const contains = [...Array.from({ length: 10 }, (_, i) => ({ product_code: `B${i}` })), { product_code: 'A00' }];
    const merged = mergeSearch(prefix, contains);
    expect(merged).toHaveLength(20);
    expect(merged.slice(0, 15)).toEqual(prefix);
    expect(merged.filter((r) => r.product_code === 'A00')).toHaveLength(1);
  });
});

const ex = (code: string, name: string, unit: string, active = true): [string, ExistingProduct] => [code, { product_code: code, product_name: name, unit, is_active: active }];

describe('匯入計畫 planImport', () => {
  const existing = new Map<string, ExistingProduct>([ex('A1', '舊名', '瓶'), ex('A2', '同名', '盒'), ex('A3', '停用品', '條', false)]);
  const inputs = [
    { row: 2, code: 'A1', name: '新名', unit: '瓶' }, // 更新
    { row: 3, code: 'A2', name: '同名', unit: '盒' }, // 內容相同略過
    { row: 4, code: 'A3', name: '停用品', unit: '條' }, // 內容相同但停用 -> 更新並重新啟用
    { row: 5, code: 'N1', name: '全新', unit: '' }, // 新增
    { row: 6, code: '', name: '缺編號', unit: '' },
    { row: 7, code: 'N2', name: '', unit: '' },
    { row: 8, code: 'D', name: '第一次', unit: '' }, // 檔內重複
    { row: 9, code: 'D', name: '第二次', unit: '個' },
    { row: 10, code: 'T'.repeat(65), name: '編號過長', unit: '' },
  ];
  const plan = planImport(inputs, existing);
  it('分類與數量', () => {
    expect(plan.counts).toEqual({ total: 9, inserted: 2, updated: 2, reactivated: 1, skipped: 5 });
    expect(plan.inserts.map((r) => r.code)).toEqual(['N1', 'D']);
    expect(plan.inserts.find((r) => r.code === 'D')).toMatchObject({ row: 9, name: '第二次' });
    expect(plan.updates.map((r) => [r.code, r.reactivate])).toEqual([['A1', false], ['A3', true]]);
  });
  it('略過原因（停用品復活不算略過）與列號排序', () => {
    expect(plan.skipped.map((s) => [s.row, s.reason])).toEqual([
      [3, 'unchanged'],
      [6, 'missing_code'],
      [7, 'missing_name'],
      [8, 'duplicate_in_file'],
      [10, 'too_long'],
    ]);
    expect(plan.skipped.every((s) => s.text.length > 0)).toBe(true);
  });
  it('全空列算缺編號', () => {
    const p = planImport([{ row: 2, code: '', name: '', unit: '' }], new Map());
    expect(p.counts).toMatchObject({ inserted: 0, updated: 0, skipped: 1 });
  });
  it('舊版 filter 後會寫入的列，新版全部會新增（空庫、無重複時集合相同）', () => {
    const rows = [{ 商品編號: 'Z1', 商品名稱: '甲', 單位: '瓶' }, { 編號: 'Z2', 品名: '乙' }, { 商品編號: 'Z3' }, { 品名: '無編號' }];
    const legacy = rows.map(legacyRecord).filter((r) => r.product_code && r.product_name);
    const p = planImport(rows.map((r, i) => ({ row: i + 2, ...normalizeExcelRow(r) })), new Map());
    expect(p.inserts.map((r) => [r.code, r.name, r.unit])).toEqual(legacy.map((r) => [r.product_code, r.product_name, r.unit]));
  });
});

describe('其他', () => {
  it('sanitizeInputs 不信任前端：非陣列回 null、數字轉字串、去空白', () => {
    expect(sanitizeInputs({})).toBeNull();
    expect(sanitizeInputs([{ row: 5, code: ' 12 ', name: 34, unit: null }])).toEqual([{ row: 5, code: '12', name: '34', unit: '' }]);
    expect(sanitizeInputs([{}])).toEqual([{ row: 2, code: '', name: '', unit: '' }]);
  });
  it('500 筆一批', () => {
    expect(IMPORT_BATCH_SIZE).toBe(500);
    expect(chunk(Array.from({ length: 1201 }, (_, i) => i)).map((p) => p.length)).toEqual([500, 500, 201]);
    expect(chunk([])).toEqual([]);
  });
});
