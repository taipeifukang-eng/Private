import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PAGE_SIZE, detailTotals, filterRows, filterSortPage, nextSort, pageCount, sortRows, togglePosition, type PurchaseRow } from '../../../vue-workspace/src/employee-purchases-view';

// P01 單元層：員工購物頁的搜尋、排序、分頁、明細加總與職稱卡切換。

const row = (i: number, over: Partial<PurchaseRow> = {}): PurchaseRow => ({
  id: String(i),
  recognized_store_code: i % 2 ? 'ZT01' : 'ZT02',
  recognized_store_name: i % 2 ? '測試一店' : '測試二店',
  employee_code: `E${String(i).padStart(3, '0')}`,
  employee_name: `員工${i}`,
  employee_position: '專員',
  purchase_count: i,
  total_amount: i * 100,
  ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

describe('P01 分頁（每頁 50 筆）', () => {
  it('頁數與邊界：0 筆 1 頁、50 筆 1 頁、51 筆 2 頁', () => {
    expect(PAGE_SIZE).toBe(50);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(101)).toBe(3);
  });
  it('第 51 筆在第 2 頁，第 1 頁剛好 50 筆', () => {
    const rows = many(51);
    const p1 = filterSortPage(rows, '', '', 0, 1);
    const p2 = filterSortPage(rows, '', '', 0, 2);
    expect(p1.rows).toHaveLength(50);
    expect(p1.rows[49].id).toBe('50');
    expect(p2.rows.map((r) => r.id)).toEqual(['51']);
    expect(p2.pages).toBe(2);
    expect(p2.total).toBe(51);
  });
  it('頁碼超出範圍時夾回有效頁', () => {
    const rows = many(51);
    expect(filterSortPage(rows, '', '', 0, 99).page).toBe(2);
    expect(filterSortPage(rows, '', '', 0, 0).page).toBe(1);
    expect(filterSortPage([], '', '', 0, 5)).toMatchObject({ page: 1, pages: 1, total: 0, rows: [] });
  });
});

describe('P01 搜尋', () => {
  const rows = [row(1, { employee_name: '王小明' }), row(2, { employee_name: '李大華', recognized_store_name: '安程店' }), row(3, { employee_code: 'ABC9', employee_name: '' })];
  it('空白搜尋回傳全部', () => {
    expect(filterRows(rows, '')).toHaveLength(3);
    expect(filterRows(rows, '   ')).toHaveLength(3);
  });
  it('中文姓名、員編（不分大小寫）、認列門市代號與名稱', () => {
    expect(filterRows(rows, '小明').map((r) => r.id)).toEqual(['1']);
    expect(filterRows(rows, 'abc9').map((r) => r.id)).toEqual(['3']);
    expect(filterRows(rows, '安程').map((r) => r.id)).toEqual(['2']);
    expect(filterRows(rows, 'zt01').map((r) => r.id)).toEqual(['1', '3']);
  });
  it('查無結果', () => {
    expect(filterRows(rows, '不存在')).toEqual([]);
  });
  it('搜尋後再分頁：總數用搜尋後的筆數', () => {
    const r = filterSortPage(many(120), 'E1', '', 0, 1);
    expect(r.total).toBe(filterRows(many(120), 'E1').length);
  });
});

describe('P01 排序（舊版：第一次由大到小，再點由小到大，第三次還原）', () => {
  it('nextSort 循環', () => {
    let s = { key: '', direction: 0 as 0 | 1 | -1 };
    s = nextSort(s, 'total_amount');
    expect(s).toEqual({ key: 'total_amount', direction: -1 });
    s = nextSort(s, 'total_amount');
    expect(s).toEqual({ key: 'total_amount', direction: 1 });
    s = nextSort(s, 'total_amount');
    expect(s).toEqual({ key: 'total_amount', direction: 0 });
    s = nextSort(s, 'total_amount');
    expect(s.direction).toBe(-1);
    expect(nextSort(s, 'purchase_count')).toEqual({ key: 'purchase_count', direction: -1 });
  });
  it('數字欄位用數值比較（9 < 10），不是字串比較', () => {
    const rows = [row(10), row(9), row(100)];
    expect(sortRows(rows, 'purchase_count', 1).map((r) => r.purchase_count)).toEqual([9, 10, 100]);
    expect(sortRows(rows, 'purchase_count', -1).map((r) => r.purchase_count)).toEqual([100, 10, 9]);
  });
  it('門市欄以「代號 名稱」排序，且不改動原陣列', () => {
    const rows = [row(2), row(1)];
    const sorted = sortRows(rows, 'recognized_store', 1);
    expect(sorted.map((r) => r.recognized_store_code)).toEqual(['ZT01', 'ZT02']);
    expect(rows.map((r) => r.id)).toEqual(['2', '1']);
  });
  it('字串自然排序：員編 E2 在 E10 之前', () => {
    const rows = [row(1, { employee_code: 'E10' }), row(2, { employee_code: 'E2' })];
    expect(sortRows(rows, 'employee_code', 1).map((r) => r.employee_code)).toEqual(['E2', 'E10']);
  });
  it('direction 為 0 或沒有 key：維持原順序', () => {
    const rows = [row(2), row(1)];
    expect(sortRows(rows, '', -1)).toBe(rows);
    expect(sortRows(rows, 'total_amount', 0)).toBe(rows);
  });
  it('空值排在字串最前（以空字串比較）', () => {
    const rows = [row(1, { employee_position: '專員' }), row(2, { employee_position: '' })];
    expect(sortRows(rows, 'employee_position', 1).map((r) => r.id)).toEqual(['2', '1']);
  });
});

describe('P01 明細加總（舊版 employeeDetailTotals 四項）', () => {
  it('購買筆數、數量、金額、毛利', () => {
    expect(
      detailTotals([
        { purchase_count: 2, quantity: 1.5, gross_profit: 10, total_amount: 100 },
        { purchase_count: 3, quantity: 2, gross_profit: 5.5, total_amount: 250 },
      ]),
    ).toEqual({ purchaseCount: 5, quantity: 3.5, grossProfit: 15.5, totalAmount: 350 });
  });
  it('空陣列與缺值', () => {
    expect(detailTotals([])).toEqual({ purchaseCount: 0, quantity: 0, grossProfit: 0, totalAmount: 0 });
    expect(detailTotals([{}])).toEqual({ purchaseCount: 0, quantity: 0, grossProfit: 0, totalAmount: 0 });
  });
});

describe('P01 職稱卡切換（舊版：再點已選職稱取消篩選）', () => {
  it('點另一個職稱就切換，點同一個就清除', () => {
    expect(togglePosition('', '專員')).toBe('專員');
    expect(togglePosition('專員', '店長')).toBe('店長');
    expect(togglePosition('專員', '專員')).toBe('');
  });
});

describe('P01 頁面使用共用函式', () => {
  const vue = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'vue-workspace/src/pages/EmployeePurchases.vue'), 'utf8');
  it('排序、分頁、明細加總、職稱切換都走 employee-purchases-view', () => {
    for (const name of ['filterSortPage', 'nextSort', 'detailTotals', 'togglePosition']) expect(vue).toContain(name);
    expect(vue).toContain('購買筆數');
    expect(vue).toContain('data-detail-totals');
  });
});
