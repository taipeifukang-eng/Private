import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageInventoryLocations } from '@/lib/general-affairs/inventory/locations/access';
import { canReadParts } from '@/lib/general-affairs/parts/access';
import {
  validateDeletionReason,
  validateInventoryLocationPartPayload,
  validateUuid,
} from '@/lib/general-affairs/inventory/locations/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const message = error instanceof Error ? error.message : String(error || '位置料件設定操作失敗');
  const isNotFound = anyError?.code === 'PGRST116';
  const isValidationError =
    message.includes('不可由 Client 指定') ||
    message.includes('必須') ||
    message.includes('請輸入') ||
    message.includes('錯誤') ||
    message.includes('不可') ||
    message.includes('不得');
  const resolvedStatus = isNotFound ? 404 : (anyError?.code === '23505' ? 409 : (status === 500 && isValidationError ? 400 : status));
  return NextResponse.json({ success: false, error: isNotFound ? '找不到位置料件設定' : message }, { status: resolvedStatus });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; locationPartId: string } },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageInventoryLocations()) return jsonError('沒有庫存位置管理權限', 403);

    const locationId = validateUuid(params.id, '庫存位置 id');
    const locationPartId = validateUuid(params.locationPartId, '位置料件設定 id');
    const body = await request.json();
    const normalized = validateInventoryLocationPartPayload(body, { partial: true });
    if (normalized.part_id && !await canReadParts()) {
      return jsonError('缺少 general_affairs.part.view，因此無法變更位置料件設定的料件。', 403);
    }

    const { data, error } = await supabase
      .from('ga_inventory_location_parts')
      .update(normalized)
      .eq('id', locationPartId)
      .eq('location_id', locationId)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; locationPartId: string } },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageInventoryLocations()) return jsonError('沒有庫存位置管理權限', 403);

    validateUuid(params.id, '庫存位置 id');
    const locationPartId = validateUuid(params.locationPartId, '位置料件設定 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body?.deletion_reason);

    const { data: result, error } = await supabase.rpc('ga_soft_delete_inventory_location_part', {
      p_location_part_id: locationPartId,
      p_reason: reason,
    });

    if (error) throw error;
    if (!result?.ok) return jsonError(result?.error || '位置料件設定刪除失敗', Number(result?.status || 500));
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return jsonError(error);
  }
}
