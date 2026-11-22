import { checked, type Context } from './server';
import {
  MONTHLY_EXPORT_GENERAL_PERMISSION,
  deriveExportStoreStatus,
  exportAccess,
  type ExportAccess,
  type ExportStoreRow,
} from './monthly-export';

const PAGE = 1000;

/** 分頁讀完全部資料（PostgREST 單次最多 1000 列）。 */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = checked(await build(from, from + PAGE - 1)) || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * 各門市在指定月份的提交狀態。輸出與舊 /api/export-monthly-status/stores 逐欄相同（改成分頁批次查詢，避免逐店查詢）。
 * 使用呼叫者的 session client，與舊版受相同的資料列可見範圍限制。
 *
 * 注意（與舊版逐字相同的既有行為）：舊 route 讀 monthly_store_summary 的 `summary?.status`，但該表的欄位叫 store_status，
 * 沒有 status，所以舊版實際上永遠只依人員列推導（任一筆已確認 → 已確認；任一筆已提交 → 已提交）。
 * 為了與舊版輸出一致，這裡同樣只看人員列，不讀摘要表。
 */
export async function loadExportStores(ctx: Context, yearMonth: string, onlyStoreIds?: readonly string[], options: { allStores?: boolean; activeOnly?: boolean } = {}): Promise<ExportStoreRow[]> {
  // allStores：以 admin client 看全部門市（規格 A：能進入的人所有匯出都不限門市，不受任命門市或資料列可見範圍影響）。
  const db = options.allStores ? ctx.admin : ctx.auth;
  // 守衛（allStores）要連已停用門市一起看：舊版對停用門市照常產檔，守衛只擋不存在的門市；門市清單另以 activeOnly 只列啟用門市。
  const storeBase = db.from('stores').select('id, store_code, store_name, is_active').order('store_code');
  const stores = checked(await (options.allStores && !options.activeOnly ? storeBase : storeBase.eq('is_active', true))) || [];
  const staff = await fetchAll<{ id: string; store_id: string; status: string | null }>((from, to) =>
    db.from('monthly_staff_status').select('id, store_id, status').eq('year_month', yearMonth).order('id').range(from, to),
  );
  const counts = new Map<string, { total: number; submitted: number; confirmed: number }>();
  for (const r of staff) {
    const c = counts.get(r.store_id) || { total: 0, submitted: 0, confirmed: 0 };
    c.total += 1;
    if (r.status === 'submitted') c.submitted += 1;
    if (r.status === 'confirmed') c.confirmed += 1;
    counts.set(r.store_id, c);
  }
  const wanted = onlyStoreIds ? new Set(onlyStoreIds) : null;
  return (stores as { id: string; store_code: string; store_name: string; is_active?: boolean }[])
    .filter((s) => !wanted || wanted.has(s.id))
    .map((s) => {
      const c = counts.get(s.id) || { total: 0, submitted: 0, confirmed: 0 };
      return {
        id: s.id,
        store_code: s.store_code,
        store_name: s.store_name,
        total_employees: c.total,
        submitted_count: c.submitted,
        confirmed_count: c.confirmed,
        store_status: deriveExportStoreStatus(undefined, c.confirmed, c.submitted),
        ...(options.allStores && !options.activeOnly ? { is_active: s.is_active !== false } : {}),
      };
    });
}

export async function loadExportAccess(ctx: Context): Promise<ExportAccess> {
  return exportAccess({ hasGeneral: ctx.has(MONTHLY_EXPORT_GENERAL_PERMISSION) });
}
