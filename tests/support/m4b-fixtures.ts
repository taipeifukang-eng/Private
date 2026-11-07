import { adminDb, deleteRunMasters, seedMaster, type SeedMaster } from './m4-fixtures';
import { SIGNED } from './png';

// M4 後半（W16 詳情與列印、W17 改善追蹤、P04 巡店比較）共用種子工具。
// 資料原則同 m4-fixtures：只用 ZT／VW 測試門市、保留月份 2099；巡店主表備註帶 ZT<runId>-M4 標記，
// 子表（明細、改善項目、當班人員）靠外鍵 cascade 隨主表刪除，測試結束只刪自己建立的列。

export const M4B_MONTH = { followup: '2099-07', detail: '2099-08', compare: '2099-09', boundary: '2099-10' } as const;
export { deleteRunMasters, seedMaster };

export type Template = { id: string; section_name: string; item_name: string; max_score: number; section_order: number; item_order: number };
/** 前 n 個啟用範本項目（依區塊與項目順序，與詳情頁排序一致）。 */
export async function activeTemplates(n: number): Promise<Template[]> {
  const r = await adminDb()
    .from('inspection_templates')
    .select('id,section_name,item_name,max_score,section_order,item_order')
    .eq('is_active', true)
    .order('section_order')
    .order('item_order')
    .limit(n);
  if (r.error || (r.data || []).length < n) throw new Error(`DEV 範本項目不足 ${n} 個：${r.error?.message || ''}`);
  return r.data.map((t: any) => ({ ...t, max_score: Number(t.max_score) }));
}

export type FindingSpec = { template: Template; deduction: number; notes?: string; items?: string[] };
/** 為一張巡店單寫入明細（有扣分者標需改善）。完成單的督導巡店會由資料庫觸發器自動產生改善項目（待改善，期限＝巡店日＋最大天數）。 */
export async function seedResults(masterId: string, findings: FindingSpec[]) {
  const rows = findings.map((f) => {
    const deduction = Math.min(f.deduction, f.template.max_score);
    return {
      inspection_id: masterId,
      template_id: f.template.id,
      max_score: f.template.max_score,
      given_score: f.template.max_score - deduction,
      deduction_amount: deduction,
      is_improvement: deduction > 0,
      notes: f.notes ?? (deduction > 0 ? `缺失說明 ${f.template.item_name}` : null),
      selected_items: f.items ?? (deduction > 0 ? ['測試缺失項目'] : []),
      photo_urls: [],
    };
  });
  const r = await adminDb().from('inspection_results').insert(rows).select('id,template_id');
  if (r.error) throw new Error(`寫入測試明細失敗：${r.error.message}`);
  return r.data as { id: string; template_id: string }[];
}

export async function improvementsOf(masterId: string): Promise<any[]> {
  const r = await adminDb().from('inspection_improvements').select('*').eq('inspection_id', masterId).order('created_at');
  if (r.error) throw new Error(`回讀改善項目失敗：${r.error.message}`);
  return r.data || [];
}
export async function readImprovement(id: string): Promise<any> {
  const r = await adminDb().from('inspection_improvements').select('*').eq('id', id).single();
  if (r.error) throw new Error(`回讀改善項目失敗：${r.error.message}`);
  return r.data;
}
/** 只改自己種子建立的改善項目（例如把期限調成過去、狀態改成補跑程式標的 overdue）。 */
export async function patchImprovement(id: string, patch: Record<string, unknown>) {
  const r = await adminDb().from('inspection_improvements').update(patch).eq('id', id);
  if (r.error) throw new Error(`調整測試改善項目失敗：${r.error.message}`);
}
export async function bonusRulesDb() {
  const r = await adminDb().from('inspection_bonus_config').select('day_from,day_to,bonus_score,sort_order,is_active,description').eq('is_active', true).order('sort_order');
  if (r.error) throw new Error(`讀取回補規則失敗：${r.error.message}`);
  return (r.data || []).map((x: any) => ({ ...x, bonus_score: Number(x.bonus_score) }));
}

/** 一張帶改善項目的完成單：count 個扣分明細，回傳 master id 與改善項目。 */
export async function seedFollowupInspection(
  spec: Omit<SeedMaster, 'status'> & { count: number; deduction?: number; type?: 'supervisor' | 'manager' },
) {
  const { count, deduction, ...rest } = spec;
  const templates = await activeTemplates(count);
  const id = await seedMaster({ ...rest, status: 'completed', total: rest.total ?? 220 - count * (deduction ?? 4) });
  await seedResults(id, templates.map((template) => ({ template, deduction: deduction ?? 4 })));
  return { id, templates, improvements: await improvementsOf(id) };
}

/** 改善回報要送的內容（一張小圖）。 */
export const reportBody = (id: string, version: string, extra: Record<string, unknown> = {}) => ({
  id,
  version,
  description: '已更換並補貨，現場恢復整齊（自動測試）',
  photos: [SIGNED()],
  ...extra,
});
