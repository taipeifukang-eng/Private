import { checked, type Context } from './server';
import { moduleCodes, moduleStores } from './modules';
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
export async function loadExportStores(ctx: Context, yearMonth: string, onlyStoreIds?: readonly string[], options: { allStores?: boolean } = {}): Promise<ExportStoreRow[]> {
  // allStores：守衛用，以 admin client 看全部門市（單品獎金舊版不限門市，守衛不能被呼叫者的資料列可見範圍影響）。
  const db = options.allStores ? ctx.admin : ctx.auth;
  const storeQuery = db.from('stores').select('id, store_code, store_name').eq('is_active', true).order('store_code');
  const stores = checked(await storeQuery) || [];
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
  return (stores as { id: string; store_code: string; store_name: string }[])
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
      };
    });
}

export async function loadExportAccess(ctx: Context): Promise<ExportAccess> {
  const profile = checked(
    await ctx.admin.from('profiles').select('role, department, job_title').eq('id', ctx.user.id).maybeSingle(),
  );
  return exportAccess({
    hasGeneral: ctx.has(MONTHLY_EXPORT_GENERAL_PERMISSION),
    hasMonthlyModule: ctx.has(...moduleCodes.monthly),
    profile,
  });
}

/**
 * 沒有一般匯出權限的人（只有單品獎金）只能選自己有權限看的門市。
 * 例外：沒有指派門市的支援時數角色（督導、經理、營業部主管）舊版單品獎金只檢查登入、不限門市，故回傳全部有效門市（null）。
 */
export async function scopedExportStoreIds(ctx: Context, access?: ExportAccess): Promise<string[] | null> {
  if (ctx.has(MONTHLY_EXPORT_GENERAL_PERMISSION) || ctx.has('monthly.status.view_all')) return null;
  const assigned = (await moduleStores(ctx, 'monthly')).map((s: { id: string }) => s.id);
  if (!assigned.length && access?.supportHours) return null;
  return assigned;
}
