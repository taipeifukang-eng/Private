import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canPostInventoryTransactions } from '@/lib/general-affairs/inventory/transactions/access';
import { jsonError, jsonSuccess } from '@/lib/general-affairs/inventory/transactions/api';
import { validateUuid } from '@/lib/general-affairs/inventory/transactions/validation';

export const dynamic = 'force-dynamic';

function quantity(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || /e/i.test(String(value))) {
    throw new Error(`INVALID_HOLDING_QUANTITY: ${label}必須是 0 以上的數字`);
  }
  return parsed;
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('UNAUTHENTICATED: 未登入');
    if (!await canPostInventoryTransactions()) return jsonError('PERMISSION_DENIED: 沒有庫存狀態管理權限', 'PERMISSION_DENIED', 403);

    const balanceId = validateUuid(params.id, '庫存餘額 id');
    const body = await request.json();
    const inUseQuantity = quantity(body.in_use_quantity, '使用中數量');
    const idleQuantity = quantity(body.idle_quantity, '閒置數量');
    const notes = String(body.notes || '').trim().slice(0, 500) || null;

    const { data, error } = await supabase.rpc('ga_set_inventory_holding_allocation', {
      p_balance_id: balanceId,
      p_in_use_quantity: inUseQuantity,
      p_idle_quantity: idleQuantity,
      p_notes: notes,
    });
    if (error) throw error;
    return jsonSuccess(data);
  } catch (error) {
    return jsonError(error, 'VALIDATION_ERROR');
  }
}
