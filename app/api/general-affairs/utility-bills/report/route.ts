import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canViewUtilityBills } from '@/lib/general-affairs/utility-bills/access';

export const dynamic = 'force-dynamic';

type ExpenseType = 'WATER' | 'ELECTRICITY' | 'PHONE' | 'INTERNET';
type StoreRow = { id: string; store_code: string; store_name: string; short_name: string | null };
type Totals = { WATER: number; ELECTRICITY: number; PHONE: number; INTERNET: number; total: number; bill_count: number };

const EMPTY_TOTALS = (): Totals => ({ WATER: 0, ELECTRICITY: 0, PHONE: 0, INTERNET: 0, total: 0, bill_count: 0 });
const TYPES = new Set<ExpenseType>(['WATER', 'ELECTRICITY', 'PHONE', 'INTERNET']);

function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error || '查詢失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

function dateRange(params: URLSearchParams) {
  const mode = params.get('mode');
  const year = Number(params.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('請選擇正確年度');
  if (mode === 'month') {
    const month = params.get('period') || '';
    if (!new RegExp(`^${year}-(0[1-9]|1[0-2])$`).test(month)) throw new Error('請選擇正確月份');
    const [y, m] = month.split('-').map(Number);
    const next = new Date(Date.UTC(y, m, 1));
    return { start: `${month}-01`, end: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01` };
  }
  if (mode === 'quarter') {
    const quarter = Number(params.get('period'));
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error('請選擇正確季度');
    const startMonth = (quarter - 1) * 3 + 1;
    const end = new Date(Date.UTC(year, startMonth - 1 + 3, 1));
    return {
      start: `${year}-${String(startMonth).padStart(2, '0')}-01`,
      end: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-01`,
    };
  }
  if (mode === 'year') return { start: `${year}-01-01`, end: `${year + 1}-01-01` };
  throw new Error('請選擇月、季或年報表');
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('未登入', 401);
    if (!await canViewUtilityBills()) return fail('沒有費用紀錄查看權限', 403);

    const { start, end } = dateRange(new URL(request.url).searchParams);
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('id, store_code, store_name, short_name')
      .eq('is_active', true)
      .order('store_code');
    if (storesError) throw storesError;

    const totalsByLocation = new Map<string, { store: StoreRow | null; location_name: string; totals: Totals }>();
    for (const store of (stores || []) as StoreRow[]) {
      totalsByLocation.set(store.id, { store, location_name: '', totals: EMPTY_TOTALS() });
    }

    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('ga_utility_bills')
        .select('store_id, location_name, expense_type, amount, store:stores(id, store_code, store_name, short_name)')
        .is('deleted_at', null)
        .gte('billing_month', start)
        .lt('billing_month', end)
        .range(offset, offset + pageSize - 1);
      if (error) throw error;

      for (const row of data || []) {
        const type = row.expense_type as ExpenseType;
        if (!TYPES.has(type)) continue;
        const joinedStore = Array.isArray(row.store) ? row.store[0] : row.store;
        const store = (joinedStore || (stores || []).find((item) => item.id === row.store_id) || null) as StoreRow | null;
        const key = store?.id || `other:${String(row.location_name || '未命名據點').trim()}`;
        const entry = totalsByLocation.get(key) || {
          store,
          location_name: String(row.location_name || '未命名據點').trim(),
          totals: EMPTY_TOTALS(),
        };
        const amount = Number(row.amount) || 0;
        entry.totals[type] += amount;
        entry.totals.total += amount;
        entry.totals.bill_count += 1;
        totalsByLocation.set(key, entry);
      }

      if ((data || []).length < pageSize) break;
    }

    const rows = Array.from(totalsByLocation.values()).map((entry) => ({
      store_id: entry.store?.id || null,
      store_code: entry.store?.store_code || null,
      location_name: entry.store
        ? `${entry.store.store_code} ${entry.store.short_name || entry.store.store_name}`
        : entry.location_name,
      ...entry.totals,
    })).sort((a, b) => b.total - a.total || a.location_name.localeCompare(b.location_name, 'zh-TW'));

    const totals = rows.reduce((sum, row) => {
      sum.WATER += row.WATER;
      sum.ELECTRICITY += row.ELECTRICITY;
      sum.PHONE += row.PHONE;
      sum.INTERNET += row.INTERNET;
      sum.total += row.total;
      sum.bill_count += row.bill_count;
      return sum;
    }, EMPTY_TOTALS());

    return NextResponse.json({ success: true, data: { rows, totals, start, end } });
  } catch (error) {
    return fail(error, 500);
  }
}
