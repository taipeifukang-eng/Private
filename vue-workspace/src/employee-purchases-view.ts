// 員工購物管理頁的純函式（M1 P01）：搜尋、排序、分頁與明細加總，供畫面與單元測試共用。
// 排序行為與舊版 app/admin/employee-purchases/page.tsx 相同：
// 第一次點欄位為由大到小、再點為由小到大、第三次還原；門市欄以「代號 名稱」排序，中文用 zh-Hant-TW 且數字自然排序。

export const PAGE_SIZE = 50;

export type PurchaseRow = {
  id?: string;
  recognized_store_code?: string;
  recognized_store_name?: string;
  employee_code?: string;
  employee_name?: string;
  employee_position?: string;
  purchase_count?: number;
  total_amount?: number;
};

export type SortKey = 'recognized_store' | 'employee_code' | 'employee_name' | 'employee_position' | 'purchase_count' | 'total_amount';
/** -1：由大到小；1：由小到大；0：不排序。 */
export type SortDirection = -1 | 0 | 1;

export function nextSort(current: { key: string; direction: SortDirection }, key: string): { key: string; direction: SortDirection } {
  if (current.key !== key) return { key, direction: -1 };
  if (current.direction === -1) return { key, direction: 1 };
  if (current.direction === 1) return { key, direction: 0 };
  return { key, direction: -1 };
}

function sortValue(row: PurchaseRow, key: string): string | number | undefined {
  if (key === 'recognized_store') return `${row.recognized_store_code || ''} ${row.recognized_store_name || ''}`.trim();
  return (row as Record<string, string | number | undefined>)[key];
}

export function filterRows(rows: PurchaseRow[], query: string): PurchaseRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => [r.employee_code, r.employee_name, r.recognized_store_code, r.recognized_store_name].some((x) => String(x || '').toLowerCase().includes(q)));
}

export function sortRows(rows: PurchaseRow[], key: string, direction: SortDirection): PurchaseRow[] {
  if (!key || !direction) return rows;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    const compare = typeof left === 'number' && typeof right === 'number' ? left - right : String(left || '').localeCompare(String(right || ''), 'zh-Hant-TW', { numeric: true });
    return compare * direction;
  });
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function filterSortPage(rows: PurchaseRow[], query: string, key: string, direction: SortDirection, page: number, size = PAGE_SIZE) {
  const filtered = sortRows(filterRows(rows, query), key, direction);
  const pages = pageCount(filtered.length, size);
  const current = Math.min(Math.max(1, page), pages);
  return { total: filtered.length, pages, page: current, rows: filtered.slice((current - 1) * size, current * size) };
}

export type PurchaseDetail = { purchase_count?: number; quantity?: number; gross_profit?: number; total_amount?: number };

/** 明細加總（舊版 employeeDetailTotals：購買筆數、數量、金額、毛利四項）。 */
export function detailTotals(details: PurchaseDetail[]) {
  return {
    purchaseCount: details.reduce((sum, r) => sum + Number(r.purchase_count || 0), 0),
    quantity: details.reduce((sum, r) => sum + Number(r.quantity || 0), 0),
    grossProfit: details.reduce((sum, r) => sum + Number(r.gross_profit || 0), 0),
    totalAmount: details.reduce((sum, r) => sum + Number(r.total_amount || 0), 0),
  };
}

/** 點職稱卡：再點一次已選的職稱會取消篩選（舊版行為）。 */
export function togglePosition(selected: string, clicked: string): string {
  return clicked === selected ? '' : clicked;
}
