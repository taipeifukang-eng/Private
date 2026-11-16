import type { SupabaseClient } from '@supabase/supabase-js';
import type { AliasMap } from '@/lib/performance/prescription-import';

export type AliasRecord = { id: string; alias: string; store_id: string; updated_at: string };

export async function loadAliasRecords(admin: SupabaseClient): Promise<{ data: AliasRecord[]; error?: string }> {
  const { data, error } = await admin
    .from('prescription_store_aliases')
    .select('id, alias, store_id, updated_at')
    .order('alias');
  if (error) {
    console.error('[Prescription report] alias lookup failed:', error);
    return { data: [], error: '讀取門市簡稱對照表失敗' };
  }
  return { data: (data || []) as AliasRecord[] };
}

export function toAliasMap(records: AliasRecord[]): AliasMap {
  return new Map(records.map(record => [record.alias, record.store_id]));
}
