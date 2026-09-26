import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessInventoryBalances } from '@/lib/general-affairs/inventory/transactions/access';
import { jsonError, jsonSuccess } from '@/lib/general-affairs/inventory/transactions/api';
import {
  getPagination,
  parseBooleanParam,
  validateOptionalUuidParam,
} from '@/lib/general-affairs/inventory/transactions/validation';

export const dynamic = 'force-dynamic';

const BALANCE_SORT_COLUMNS = new Set(['quantity_base', 'last_transaction_at', 'updated_at', 'created_at']);

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('UNAUTHENTICATED: 未登入');
    if (!await canAccessInventoryBalances()) return jsonError('PERMISSION_DENIED: 沒有庫存餘額查看權限');

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);
    const locationId = validateOptionalUuidParam(searchParams, 'locationId', '庫存位置 id');
    const partId = validateOptionalUuidParam(searchParams, 'partId', '料件 id');
    const includeZero = parseBooleanParam(searchParams, 'includeZero') === true;
    const sortBy = BALANCE_SORT_COLUMNS.has(searchParams.get('sort') || '')
      ? searchParams.get('sort')!
      : 'last_transaction_at';
    const ascending = searchParams.get('sortOrder') === 'asc';

    let query = supabase
      .from('ga_inventory_balances')
      .select(`
        id,
        location_id,
        part_id,
        quantity_base,
        last_transaction_id,
        last_transaction_at,
        version,
        created_at,
        updated_at,
        location:ga_inventory_locations(
          id,
          code,
          name,
          location_type,
          store_id,
          allow_negative_stock,
          store:stores(id, store_code, store_name, short_name)
        ),
        part:ga_parts(
          id,
          category_id,
          name,
          part_code,
          brand,
          model,
          specification,
          base_unit,
          purchase_unit,
          purchase_to_base_rate,
          minimum_issue_qty,
          allow_fractional_issue,
          allow_unpacking
        )
      `, { count: 'exact' });

    if (locationId) query = query.eq('location_id', locationId);
    if (partId) query = query.eq('part_id', partId);
    if (!includeZero) query = query.neq('quantity_base', 0);

    const search = searchParams.get('search')?.trim();
    if (search) {
      const { data: locationRows, error: locationError } = await supabase
        .from('ga_inventory_locations')
        .select('id')
        .or(`name.ilike.%${search}%,code.ilike.%${search}%`)
        .is('deleted_at', null);
      if (locationError) throw locationError;

      const { data: partRows, error: partError } = await supabase
        .from('ga_parts')
        .select('id')
        .or(`name.ilike.%${search}%,part_code.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%,specification.ilike.%${search}%`)
        .is('deleted_at', null);
      if (partError) throw partError;

      const locationIds = (locationRows || []).map((row) => row.id);
      const partIds = (partRows || []).map((row) => row.id);
      if (locationIds.length === 0 && partIds.length === 0) {
        return jsonSuccess([], {
          meta: { page, pageSize, total: 0, totalPages: 1 },
        });
      }
      const clauses = [
        ...locationIds.map((id) => `location_id.eq.${id}`),
        ...partIds.map((id) => `part_id.eq.${id}`),
      ];
      query = query.or(clauses.join(','));
    }

    const { data, error, count } = await query
      .order(sortBy, { ascending, nullsFirst: false })
      .range(from, to);
    if (error) throw error;

    const balanceIds = (data || []).map((row: any) => row.id);
    const allocationByBalanceId = new Map<string, any>();
    if (balanceIds.length > 0) {
      const { data: allocations, error: allocationError } = await supabase
        .from('ga_inventory_holding_allocations')
        .select('balance_id, in_use_quantity, idle_quantity, notes, updated_at, updated_by')
        .in('balance_id', balanceIds);
      if (allocationError) throw allocationError;
      (allocations || []).forEach((allocation: any) => allocationByBalanceId.set(allocation.balance_id, allocation));
    }

    return jsonSuccess((data || []).map((row: any) => {
      const allocation = allocationByBalanceId.get(row.id);
      const quantity = Number(row.quantity_base || 0);
      const inUseQuantity = Number(allocation?.in_use_quantity || 0);
      const idleQuantity = Number(allocation?.idle_quantity || 0);
      return {
        ...row,
        quantity_on_hand: row.quantity_base,
        base_unit: row.part?.base_unit || null,
        holding: {
          in_use_quantity: inUseQuantity,
          idle_quantity: idleQuantity,
          unclassified_quantity: Math.max(0, quantity - inUseQuantity - idleQuantity),
          notes: allocation?.notes || null,
          updated_at: allocation?.updated_at || null,
          updated_by: allocation?.updated_by || null,
        },
      };
    }), {
      meta: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
