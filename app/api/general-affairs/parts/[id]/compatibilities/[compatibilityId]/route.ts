import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageParts } from '@/lib/general-affairs/parts/access';
import {
  validateDeletionReason,
  validatePartCompatibilityPayload,
  validateUuid,
} from '@/lib/general-affairs/parts/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const message = error instanceof Error ? error.message : String(error || '料件相容性操作失敗');
  const isNotFound = anyError?.code === 'PGRST116';
  const isValidationError =
    message.includes('不可由 Client 指定') ||
    message.includes('必須') ||
    message.includes('請輸入') ||
    message.includes('格式') ||
    message.includes('錯誤');
  const resolvedStatus = isNotFound ? 404 : (anyError?.code === '23505' ? 409 : (status === 500 && isValidationError ? 400 : status));
  return NextResponse.json({ success: false, error: isNotFound ? '找不到相容性資料' : message }, { status: resolvedStatus });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; compatibilityId: string } },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageParts()) return jsonError('沒有料件管理權限', 403);

    const partId = validateUuid(params.id, '料件 id');
    const compatibilityId = validateUuid(params.compatibilityId, '相容性 id');
    const body = await request.json();
    const normalized = validatePartCompatibilityPayload(body, { partial: true });

    const { data, error } = await supabase
      .from('ga_part_compatibilities')
      .update(normalized)
      .eq('id', compatibilityId)
      .eq('part_id', partId)
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
  { params }: { params: { id: string; compatibilityId: string } },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageParts()) return jsonError('沒有料件管理權限', 403);

    validateUuid(params.id, '料件 id');
    const compatibilityId = validateUuid(params.compatibilityId, '相容性 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body?.deletion_reason);

    const { data: result, error } = await supabase.rpc('ga_soft_delete_part_compatibility', {
      p_compatibility_id: compatibilityId,
      p_reason: reason,
    });

    if (error) throw error;
    if (!result?.ok) {
      return jsonError(result?.error || '相容性資料刪除失敗', Number(result?.status || 500));
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return jsonError(error);
  }
}
