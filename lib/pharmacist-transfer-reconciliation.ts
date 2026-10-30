import type { SupabaseClient } from '@supabase/supabase-js';

const codeOf = (value: unknown) => String(value || '').trim().toUpperCase();

// Full-month transfers apply immediately; partial-month transfers apply next month.
export function reconcilePharmacistTransfers(rows: any[], movements: any[], yearMonth: string, stores: any[]) {
  const storeById = new Map(stores.map(store => [store.id, store]));
  const latest = new Map<string, any>();
  for (const movement of [...movements].sort((a, b) =>
    String(a.movement_date).localeCompare(String(b.movement_date)) ||
    String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
    String(a.id || '').localeCompare(String(b.id || '')))) {
    const date = String(movement.movement_date).slice(0, 10);
    const cutoff = movement.movement_type === 'store_transfer' ? `${yearMonth}-01` : `${yearMonth}-31`;
    if (date > cutoff) continue;
    latest.set(codeOf(movement.employee_code), movement);
  }
  const result = new Map<string, any>();
  // Prefer the snapshot already at the destination if both stores have a row.
  for (const row of rows) {
    const code = codeOf(row.employee_code);
    const movement = latest.get(code);
    const destination = movement?.movement_type === 'store_transfer' ? movement.store_id : row.store_id;
    const store = storeById.get(destination);
    if (!store) continue; // Apply permissions AFTER resolving transfers, including transfers out.
    const existing = result.get(code);
    if (!existing || row.store_id === destination) {
      result.set(code, { ...row, store_id: destination, stores: store });
    }
  }
  return Array.from(result.values());
}

export async function readReconciledPharmacistMonth(client: SupabaseClient, yearMonth: string, scopedStores: any[]) {
  if (!scopedStores.length) return [];
  // Read the month's candidates across stores so incoming transfers are not lost.
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('pharmacist_monthly_snapshot')
      .select('id, store_id, employee_code, employee_name, position, is_active, source, notes')
      .eq('year_month', yearMonth).order('id').range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const codes = Array.from(new Set(rows.map(row => codeOf(row.employee_code)).filter(Boolean)));
  const movements: any[] = [];
  for (let start = 0; start < codes.length; start += 100) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from('employee_movement_history')
        .select('id, employee_code, store_id, movement_type, movement_date, created_at')
        .in('employee_code', codes.slice(start, start + 100))
        .in('movement_type', ['store_transfer', 'onboarding', 'return_to_work'])
        .lt('movement_date', nextMonthStart(yearMonth)).order('id').range(offset, offset + 999);
      if (error) throw error;
      movements.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  return reconcilePharmacistTransfers(rows, movements, yearMonth, scopedStores);
}

function nextMonthStart(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
}
