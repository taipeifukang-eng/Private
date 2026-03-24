/**
 * 根據年月批量查詢門市在當時的歷史代碼。
 *
 * 使用情境：匯出每月人員狀態、獎金、交通費等資料時，
 * 門市代號欄位應顯示「該月份當下」的舊代碼，而非搬遷後的新代碼。
 *
 * 演算法：
 * 1. 查詢 store_relocation_history，找出所有有 store_code 變更的記錄（依日期升冪）
 * 2. 對每間門市：
 *    - 找到「搬遷日期 <= 該月最後一天」的最後一筆 → new_store_code
 *    - 若所有搬遷都在該月之後 → 使用第一筆搬遷前的 old_store_code
 *    - 若無搬遷紀錄 → 使用 stores 表目前的 store_code
 */
export async function buildHistoricalStoreCodeMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeIds: string[],
  yearMonth: string // "2025-01" 格式
): Promise<Record<string, string>> {
  if (!storeIds.length) return {};

  // 計算目標月份的最後一天
  const [year, month] = yearMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

  // 一次查詢所有相關門市的搬遷歷史（依日期升冪）
  const { data: history } = await supabase
    .from('store_relocation_history')
    .select('store_id, relocation_date, old_store_code, new_store_code')
    .in('store_id', storeIds)
    .not('old_store_code', 'is', null)
    .not('new_store_code', 'is', null)
    .order('relocation_date', { ascending: true });

  // 按門市分組，僅保留有代碼實際變更的記錄
  const historyByStore: Record<
    string,
    Array<{ relocation_date: string; old_store_code: string; new_store_code: string }>
  > = {};
  for (const rec of history || []) {
    if (rec.old_store_code === rec.new_store_code) continue;
    if (!historyByStore[rec.store_id]) historyByStore[rec.store_id] = [];
    historyByStore[rec.store_id].push(rec);
  }

  // 取得目前代碼（無搬遷歷史時的 fallback）
  const { data: currentStores } = await supabase
    .from('stores')
    .select('id, store_code')
    .in('id', storeIds);

  const currentCodeMap: Record<string, string> = {};
  for (const s of currentStores || []) {
    currentCodeMap[s.id] = s.store_code;
  }

  const result: Record<string, string> = {};

  for (const storeId of storeIds) {
    const records = historyByStore[storeId];

    if (!records || records.length === 0) {
      // 無搬遷紀錄 → 用目前代碼
      result[storeId] = currentCodeMap[storeId] || '';
      continue;
    }

    // 找該月截止日當下最後一筆生效的新代碼
    let effectiveCode: string | null = null;
    for (const rec of records) {
      if (rec.relocation_date <= lastDay) {
        effectiveCode = rec.new_store_code;
      }
    }

    if (effectiveCode !== null) {
      result[storeId] = effectiveCode;
    } else {
      // 所有搬遷均在該月之後 → 用第一筆搬遷前的舊代碼
      result[storeId] = records[0].old_store_code || currentCodeMap[storeId] || '';
    }
  }

  return result;
}
