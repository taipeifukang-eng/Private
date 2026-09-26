import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessInventoryLocations, canManageInventoryLocations } from '@/lib/general-affairs/inventory/locations/access';
import {
  validateDeletionReason,
  validateInventoryLocationPayload,
  validateUuid,
} from '@/lib/general-affairs/inventory/locations/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const message = error instanceof Error ? error.message : String(error || '庫存位置操作失敗');
  const isNotFound = anyError?.code === 'PGRST116';
  const isValidationError =
    message.includes('不可由 Client 指定') ||
    message.includes('必須') ||
    message.includes('請輸入') ||
    message.includes('錯誤') ||
    message.includes('不得') ||
    message.includes('不可');
  const resolvedStatus = isNotFound ? 404 : (anyError?.code === '23505' ? 409 : (status === 500 && isValidationError ? 400 : status));
  return NextResponse.json({ success: false, error: isNotFound ? '找不到庫存位置' : message }, { status: resolvedStatus });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canAccessInventoryLocations()) return jsonError('沒有庫存位置查看權限', 403);

    const id = validateUuid(params.id, '庫存位置 id');
    const { data, error } = await supabase
      .from('ga_inventory_locations')
      .select(`
        *,
        store:stores(id, store_code, store_name, short_name)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageInventoryLocations()) return jsonError('沒有庫存位置管理權限', 403);

    const id = validateUuid(params.id, '庫存位置 id');
    const body = await request.json();
    const normalized = validateInventoryLocationPayload(body, { partial: true });

    const { data, error } = await supabase
      .from('ga_inventory_locations')
      .update(normalized)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageInventoryLocations()) return jsonError('沒有庫存位置管理權限', 403);

    const id = validateUuid(params.id, '庫存位置 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body?.deletion_reason);

    const { data: result, error } = await supabase.rpc('ga_soft_delete_inventory_location', {
      p_location_id: id,
      p_reason: reason,
    });

    if (error) throw error;
    if (!result?.ok) return jsonError(result?.error || '庫存位置刪除失敗', Number(result?.status || 500));
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return jsonError(error);
  }
}
