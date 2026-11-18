import type { APIRequestContext } from '@playwright/test';
import { adminDb } from './m5-fixtures';
import { readRowsAsServiceRole } from './parity';

/**
 * 每月人員狀態接業績管理處方箋（處方箋連動）的測試資料工具。
 * 只用 VW／ZT 測試門市與保留月份 2099-xx：處方箋與月度統計表的列都由 sweeper 的保留月份機制當後備清除（monthly_prescription_reports 已在清單內）。
 * 處方箋一律走 app 自己的 API 寫（performance-tools/prescription，與業績管理處方箋頁同一條）；
 * 舊匯入值（monthly_store_summary 的兩個舊欄位）已經沒有任何 API 會寫，只能用 service role 直接放。
 * restore() 只還原／刪除這個 helper 動過的列，不碰別人的資料。
 */
export const RX_PRESCRIPTION_API = '/api/workspace/performance-tools/prescription';

export type RxInput = {
  regular?: number | null;
  regularPoint?: number | null;
  chronic?: number | null;
  chronicPoint?: number | null;
};

export async function saveReport(api: APIRequestContext, storeId: string, month: string, v: RxInput) {
  const res = await api.post(RX_PRESCRIPTION_API, {
    data: {
      year_month: month,
      records: [{
        store_id: storeId,
        regular_prescription_count: v.regular ?? null,
        regular_prescription_point_value: v.regularPoint ?? null,
        chronic_prescription_count: v.chronic ?? null,
        chronic_prescription_point_value: v.chronicPoint ?? null,
      }],
    },
  });
  if (res.status() !== 200) throw new Error(`儲存處方箋失敗 HTTP ${res.status()} ${(await res.text()).slice(0, 120)}`);
}

export class RxFixture {
  private reportKeys: { storeId: string; month: string }[] = [];
  private summaries: { id: string | null; storeId: string; month: string; before: { regular_prescription_count: number; chronic_prescription_count: number; store_status: string } | null }[] = [];

  /** 處方箋列（走 API）。同一格重複呼叫只登記一次，結束時刪除。 */
  async report(api: APIRequestContext, storeId: string, month: string, v: RxInput) {
    await saveReport(api, storeId, month, v);
    if (!this.reportKeys.some((k) => k.storeId === storeId && k.month === month)) this.reportKeys.push({ storeId, month });
  }

  /** 直接刪掉處方箋列（模擬「該月該店沒有處方箋」）。 */
  async dropReport(storeId: string, month: string) {
    const res = await adminDb().from('monthly_prescription_reports').delete().eq('year_month', month).eq('store_id', storeId);
    if (res.error) throw new Error(`刪除處方箋失敗：${res.error.message}`);
  }

  /** 放舊匯入值（monthly_store_summary 兩個舊欄位）；status 可順便設為 submitted／confirmed 驗證「已送審也跟著變」。 */
  async legacy(storeId: string, month: string, regular: number, chronic: number, status?: string) {
    const db = adminDb();
    const rows = await readRowsAsServiceRole('monthly_store_summary', { eq: { store_id: storeId, year_month: month }, select: 'id,regular_prescription_count,chronic_prescription_count,store_status' });
    let entry = this.summaries.find((s) => s.storeId === storeId && s.month === month);
    if (!entry) {
      const old = rows[0] as any;
      entry = { id: old ? String(old.id) : null, storeId, month, before: old ? { regular_prescription_count: old.regular_prescription_count, chronic_prescription_count: old.chronic_prescription_count, store_status: old.store_status } : null };
      this.summaries.push(entry);
    }
    if (rows.length) {
      const res = await db.from('monthly_store_summary').update({ regular_prescription_count: regular, chronic_prescription_count: chronic, ...(status ? { store_status: status } : {}) }).eq('id', (rows[0] as any).id);
      if (res.error) throw new Error(`設定舊匯入值失敗：${res.error.message}`);
    } else {
      const res = await db.from('monthly_store_summary').insert({ year_month: month, store_id: storeId, total_employees: 0, confirmed_count: 0, store_status: status || 'pending', regular_prescription_count: regular, chronic_prescription_count: chronic }).select('id').single();
      if (res.error) throw new Error(`新增月度統計列失敗：${res.error.message}`);
      entry.id = null; // 這一列是我們建的，結束時刪除
    }
  }

  /** 讀回月度統計表兩個舊欄位（沒有列回 null）。 */
  async legacyOf(storeId: string, month: string) {
    const rows = await readRowsAsServiceRole('monthly_store_summary', { eq: { store_id: storeId, year_month: month }, select: 'regular_prescription_count,chronic_prescription_count' });
    return (rows[0] as { regular_prescription_count: number; chronic_prescription_count: number } | undefined) ?? null;
  }

  async restore() {
    const db = adminDb();
    for (const k of this.reportKeys) await db.from('monthly_prescription_reports').delete().eq('year_month', k.month).eq('store_id', k.storeId);
    this.reportKeys = [];
    for (const s of this.summaries) {
      if (s.before && s.id) await db.from('monthly_store_summary').update(s.before).eq('id', s.id);
      else if (!s.before) await db.from('monthly_store_summary').delete().eq('year_month', s.month).eq('store_id', s.storeId).eq('total_employees', 0).eq('confirmed_count', 0);
    }
    this.summaries = [];
  }
}

/** meta 內 rx 的三格文字（'讀取失敗' 或 [一般箋, 慢箋, 總點值]）。 */
export function rxTexts(meta: any): string[] | 'failed' | undefined {
  if (!meta?.rx) return undefined;
  if (meta.rx.failed) return 'failed';
  return [meta.rx.regular.text, meta.rx.chronic.text, meta.rx.totalPoint.text];
}
