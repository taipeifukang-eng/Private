import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessInventoryTransactions } from '@/lib/general-affairs/inventory/transactions/access';
import { jsonError, jsonSuccess, maskIdempotencyKey } from '@/lib/general-affairs/inventory/transactions/api';
import {
  getPagination,
  validateDateParam,
  validateOptionalUuidParam,
} from '@/lib/general-affairs/inventory/transactions/validation';
import { INVENTORY_TRANSACTION_TYPES } from '@/lib/general-affairs/inventory/transactions/types';

export const dynamic = 'force-dynamic';

const TRANSACTION_SORT_COLUMNS = new Set(['occurred_at', 'created_at', 'transaction_no']);

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('UNAUTHENTICATED: 未登入');
    if (!await canAccessInventoryTransactions()) return jsonError('PERMISSION_DENIED: 沒有庫存流水查看權限');

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);
    const locationId = validateOptionalUuidParam(searchParams, 'locationId', '庫存位置 id');
    const partId = validateOptionalUuidParam(searchParams, 'partId', '料件 id');
    const referenceId = validateOptionalUuidParam(searchParams, 'referenceId', 'reference id');
    const dateFrom = validateDateParam(searchParams, 'dateFrom', '起始日期');
    const dateTo = validateDateParam(searchParams, 'dateTo', '結束日期');
    const sortBy = TRANSACTION_SORT_COLUMNS.has(searchParams.get('sort') || '')
      ? searchParams.get('sort')!
      : 'occurred_at';
    const ascending = searchParams.get('sortOrder') === 'asc';

    let query = supabase
      .from('ga_inventory_transactions')
      .select(`
        id,
        transaction_no,
        transaction_type,
        location_id,
        part_id,
        quantity_input,
        input_unit_type,
        unit_conversion_rate,
        quantity_base,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        idempotency_key,
        reason,
        notes,
        occurred_at,
        created_at,
        created_by,
        location:ga_inventory_locations(
          id,
          code,
          name,
          location_type,
          store_id,
          store:stores(id, store_code, store_name, short_name)
        ),
        part:ga_parts(
          id,
          name,
          part_code,
          brand,
          model,
          specification,
          base_unit,
          purchase_unit
        ),
        creator:profiles(id, full_name, email)
      `, { count: 'exact' });

    if (locationId) query = query.eq('location_id', locationId);
    if (partId) query = query.eq('part_id', partId);
    if (referenceId) query = query.eq('reference_id', referenceId);

    const transactionType = searchParams.get('transactionType')?.trim().toUpperCase();
    if (transactionType) {
      if (!INVENTORY_TRANSACTION_TYPES.includes(transactionType as any)) {
        return jsonError('INVALID_TRANSACTION_TYPE: 庫存交易類型錯誤');
      }
      query = query.eq('transaction_type', transactionType);
    }

    const referenceType = searchParams.get('referenceType')?.trim().toUpperCase();
    if (referenceType) query = query.eq('reference_type', referenceType);
    if (dateFrom) query = query.gte('occurred_at', dateFrom);
    if (dateTo) query = query.lte('occurred_at', dateTo);

    const { data, error, count } = await query
      .order(sortBy, { ascending })
      .range(from, to);
    if (error) throw error;

    const rows = (data || []).map((row: any) => ({
      ...row,
      idempotency_key: maskIdempotencyKey(row.idempotency_key),
    }));

    return jsonSuccess(rows, {
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
