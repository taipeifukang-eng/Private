import type { SupabaseClient } from '@supabase/supabase-js';

// A month with no new movements can still be stale after a prior-month backfill.
export async function hasMissingPharmacistCarry(
  client: SupabaseClient, previousMonth: string, targetMonth: string, storeIds: string[],
) {
  if (!storeIds.length) return false;
  const readCodes = async (month: string) => {
    const codes = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from('pharmacist_monthly_snapshot')
        .select('id, employee_code').eq('year_month', month)
        .in('store_id', storeIds).order('id').range(offset, offset + 999);
      if (error) throw error;
      for (const row of data || []) {
        const code = String(row.employee_code || '').toUpperCase();
        if (code) codes.add(code);
      }
      if (!data || data.length < 1000) return codes;
    }
  };
  const [previous, current] = await Promise.all([readCodes(previousMonth), readCodes(targetMonth)]);
  return Array.from(previous).some(code => !current.has(code));
}
