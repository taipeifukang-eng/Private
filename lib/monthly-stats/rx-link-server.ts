// 伺服端讀取處方箋資料（monthly_prescription_reports 只有 service_role 可讀）。
// 以既有月度統計可見權限 monthly.status.view_stats 把關，不放寬到業績權限。
import { isHeadOfficeStoreCode, type RxReportRow } from './rx-link';

export const RX_LINK_PERMISSION = 'monthly.status.view_stats';
const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type RxLinkResult =
  | { success: true; isHeadOffice: boolean; report: RxReportRow }
  | { success: false; error: string };

type AdminLike = { from: (table: string) => any };

export async function loadRxLinkForStore(params: {
  canViewStats: boolean;
  /** 該門市是否在呼叫者可見範圍內（view_all 或被指派門市），由呼叫端用使用者權限判斷 */
  canAccessStore: boolean;
  admin: AdminLike;
  yearMonth: string;
  storeId: string;
}): Promise<RxLinkResult> {
  const { canViewStats, canAccessStore, admin, yearMonth, storeId } = params;
  if (!canViewStats) return { success: false, error: '沒有查看月度統計的權限' };
  if (!YEAR_MONTH_PATTERN.test(yearMonth || '')) return { success: false, error: '年月格式不正確' };
  if (!storeId) return { success: false, error: '缺少門市' };
  if (!canAccessStore) return { success: false, error: '沒有查看此門市的權限' };

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('id, store_code')
    .eq('id', storeId)
    .maybeSingle();
  if (storeError) return { success: false, error: storeError.message };
  if (!store) return { success: false, error: '找不到門市' };
  if (isHeadOfficeStoreCode(store.store_code)) return { success: true, isHeadOffice: true, report: null };

  const { data, error } = await admin
    .from('monthly_prescription_reports')
    .select('regular_prescription_count, regular_prescription_point_value, chronic_prescription_count, chronic_prescription_point_value')
    .eq('year_month', yearMonth)
    .eq('store_id', storeId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  return { success: true, isHeadOffice: false, report: (data as RxReportRow) ?? null };
}
