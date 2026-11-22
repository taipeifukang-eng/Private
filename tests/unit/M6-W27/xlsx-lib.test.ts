import { describe, expect, it } from 'vitest';
import * as X from 'xlsx';
import { buildWorkbook, pickColumns, readSheet, sheetToRows } from '../../../vue-workspace/src/lib/xlsx';
import { IMPORT_ALIASES } from '../../../lib/products-master/rules';

const book = (sheets: Record<string, unknown[][]>) => {
  const b = X.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) X.utils.book_append_sheet(b, X.utils.aoa_to_sheet(aoa), name);
  return new Uint8Array(X.write(b, { type: 'array', bookType: 'xlsx' }));
};

describe('M6-W26 vue-workspace/src/lib/xlsx.ts', () => {
  it('readSheet 只讀第一個工作表', async () => {
    const rows = await readSheet(book({ 第一: [['商品編號', '商品名稱'], ['A1', '甲']], 第二: [['商品編號', '商品名稱'], ['B1', '乙']] }));
    expect(rows).toEqual([{ 商品編號: 'A1', 商品名稱: '甲' }]);
  });
  it('readSheet headerRow 指定標題列（DPOS 1F 檔標題在第二列）；空儲存格預設空字串', async () => {
    const rows = await readSheet(book({ S: [['', ''], ['品號', '品名'], ['1', '']] }), { headerRow: 1 });
    expect(rows).toEqual([{ 品號: '1', 品名: '' }]);
  });
  it('沒有資料列回空陣列；沒有工作表丟錯', async () => {
    expect(await readSheet(book({ S: [['商品編號']] }))).toEqual([]);
    expect(() => sheetToRows(X, undefined)).toThrow('檔案沒有工作表');
  });
  it('pickColumns：依別名順序取第一個有值的，大小寫與去空白容忍，找不到回空字串', () => {
    expect(pickColumns({ 編號: ' 0012 ', ProductName: 'N', Unit: '瓶' }, IMPORT_ALIASES)).toEqual({ code: '0012', name: 'N', unit: '瓶' });
    expect(pickColumns({ 商品編號: '', 編號: 'B' }, { code: ['商品編號', '編號'] })).toEqual({ code: 'B' });
    expect(pickColumns({}, { a: ['x'] })).toEqual({ a: '' });
  });
  it('buildWorkbook 預設工作表名 Sheet1，可指定', () => {
    expect(buildWorkbook(X, [{ a: 1 }]).SheetNames).toEqual(['Sheet1']);
    expect(buildWorkbook(X, [{ a: 1 }], '商品主檔').SheetNames).toEqual(['商品主檔']);
  });
});
