import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canPostInventoryTransactions,
  canReadInventoryTransactionParts,
} from '@/lib/general-affairs/inventory/transactions/access';
import { extractInventoryError, jsonError, jsonSuccess } from '@/lib/general-affairs/inventory/transactions/api';
import { validateInventoryTransactionPostPayload } from '@/lib/general-affairs/inventory/transactions/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('UNAUTHENTICATED: 未登入');
    if (!await canPostInventoryTransactions()) return jsonError('PERMISSION_DENIED: 沒有庫存交易管理權限');
    if (!await canReadInventoryTransactionParts()) {
      return jsonError('PART_VIEW_REQUIRED: 缺少 general_affairs.part.view，因此無法建立庫存交易');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError('VALIDATION_ERROR: JSON 格式錯誤', 'VALIDATION_ERROR', 400);
    }

    const payload = validateInventoryTransactionPostPayload(body);
    const { data, error } = await supabase.rpc('ga_post_inventory_transaction', {
      p_transaction_type: payload.transactionType,
      p_location_id: payload.locationId,
      p_part_id: payload.partId,
      p_quantity: payload.quantity,
      p_input_unit_type: payload.inputUnitType,
      p_reason: payload.reason,
      p_notes: payload.notes ?? null,
      p_reference_type: payload.referenceType ?? null,
      p_reference_id: payload.referenceId ?? null,
      p_idempotency_key: payload.idempotencyKey,
      p_occurred_at: payload.occurredAt ?? null,
      p_metadata: payload.metadata ?? {},
    });

    if (error) {
      const parsed = extractInventoryError(error);
      return jsonError(`${parsed.code}: ${parsed.message}`, parsed.code, parsed.status);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return jsonSuccess(row, { status: 201 });
  } catch (error) {
    return jsonError(error, 'VALIDATION_ERROR');
  }
}
