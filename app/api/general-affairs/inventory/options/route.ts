import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canAccessInventoryBalances,
  canPostInventoryTransactions,
  canReadInventoryTransactionParts,
} from '@/lib/general-affairs/inventory/transactions/access';
import { jsonError, jsonSuccess } from '@/lib/general-affairs/inventory/transactions/api';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('UNAUTHENTICATED: 未登入');
    if (!await canAccessInventoryBalances() && !await canPostInventoryTransactions()) {
      return jsonError('PERMISSION_DENIED: 沒有庫存查看權限');
    }

    const canPost = await canPostInventoryTransactions();
    const canReadParts = await canReadInventoryTransactionParts();

    const { data: locations, error: locationsError } = await supabase
      .from('ga_inventory_locations')
      .select(`
        id,
        code,
        name,
        location_type,
        store_id,
        allow_negative_stock,
        is_default,
        store:stores(id, store_code, store_name, short_name)
      `)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('location_type')
      .order('name');
    if (locationsError) throw locationsError;

    if (!canReadParts) {
      return jsonSuccess({
        canPostTransactions: canPost,
        partCatalogAccess: false,
        locations: locations || [],
        parts: [],
        locationParts: [],
        balances: [],
        message: '缺少 general_affairs.part.view，因此無法載入料件交易選項。',
      });
    }

    const [{ data: locationParts, error: lpError }, { data: balances, error: balanceError }] = await Promise.all([
      supabase
        .from('ga_inventory_location_parts')
        .select(`
          id,
          location_id,
          part_id,
          is_active,
          preferred_issue_unit_type,
          safety_stock_qty,
          reorder_point_qty,
          maximum_stock_qty,
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
            allow_unpacking,
            is_active
          )
        `)
        .eq('is_active', true)
        .is('deleted_at', null),
      supabase
        .from('ga_inventory_balances')
        .select('id, location_id, part_id, quantity_base, version, last_transaction_id, last_transaction_at'),
    ]);

    if (lpError) throw lpError;
    if (balanceError) throw balanceError;

    const activeLocationIds = new Set((locations || []).map((location) => location.id));
    const usableLocationParts = (locationParts || [])
      .filter((item: any) => activeLocationIds.has(item.location_id) && item.part?.is_active === true)
      .map((item: any) => ({
        ...item,
        currentBalance: (balances || []).find((balance) => (
          balance.location_id === item.location_id && balance.part_id === item.part_id
        )) || null,
      }));

    const partMap = new Map<string, any>();
    for (const item of usableLocationParts) {
      if (item.part && !partMap.has(item.part.id)) partMap.set(item.part.id, item.part);
    }

    return jsonSuccess({
      canPostTransactions: canPost,
      partCatalogAccess: true,
      locations: locations || [],
      parts: Array.from(partMap.values()),
      locationParts: usableLocationParts,
      balances: balances || [],
    });
  } catch (error) {
    return jsonError(error);
  }
}
