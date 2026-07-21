import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageCategory, canReadCategory, getCategoryConfig } from '@/lib/general-affairs/categories/access';
import { validateCategoryId, validateCategoryPayload } from '@/lib/general-affairs/categories/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500, details?: Record<string, unknown>) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || '分類操作失敗')
      : String(error || '分類操作失敗');
  return NextResponse.json({ success: false, error: message, ...(details || {}) }, { status });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const { searchParams } = new URL(request.url);
    const config = getCategoryConfig(searchParams.get('type'));
    if (!config) return jsonError('分類類型錯誤', 400);

    const includeDeleted = searchParams.get('includeDeleted') === 'true';
    const canManage = await canManageCategory(user.id, config);
    const canRead = canManage || await canReadCategory(user.id, config);
    if (!canRead) return jsonError('沒有分類查看權限', 403);
    if (includeDeleted) return jsonError('MVP 尚未開放已刪除分類查詢', 400);

    const id = validateCategoryId(params.id);
    const query = (supabase as any).from(config.table).select('*').eq('id', id).is('deleted_at', null);

    const { data, error } = await query.single();
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

    const body = await request.json();
    const config = getCategoryConfig(body?.type);
    if (!config) return jsonError('分類類型錯誤', 400);
    if (!await canManageCategory(user.id, config)) return jsonError('沒有分類管理權限', 403);

    const id = validateCategoryId(params.id);
    const payload = {
      ...validateCategoryPayload(config, body, { partial: true }),
      updated_by: user.id,
    };

    const { data, error } = await (supabase as any)
      .from(config.table)
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;

    const warning = data?.is_active === false
      ? await getActiveChildWarning(supabase, config.table, id)
      : null;

    return NextResponse.json({ success: true, data, warning });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const { searchParams } = new URL(request.url);
    const config = getCategoryConfig(searchParams.get('type'));
    if (!config) return jsonError('分類類型錯誤', 400);
    if (!await canManageCategory(user.id, config)) return jsonError('沒有分類管理權限', 403);

    const id = validateCategoryId(params.id);
    const { data: result, error } = await supabase.rpc('ga_soft_delete_category', {
      p_kind: config.type,
      p_category_id: id,
    });
    if (error) throw error;
    if (!result?.ok) {
      return jsonError(result?.error || '分類刪除失敗', Number(result?.status || 500), {
        ...(result?.active_children_count !== undefined
          ? { active_children_count: result.active_children_count }
          : {}),
      });
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return jsonError(error);
  }
}

async function getActiveChildWarning(supabase: any, table: string, id: string) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', id)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (error) throw error;
  if (!count) return null;

  return {
    code: 'ACTIVE_CHILDREN_UNDER_INACTIVE_PARENT',
    message: '此分類已停用，但仍有啟用中的子分類；一般使用者不會看到停用祖先路徑下的子分類。',
    active_children_count: count,
  };
}
