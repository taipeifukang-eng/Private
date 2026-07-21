import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageCategory, canReadCategory, getCategoryConfig } from '@/lib/general-affairs/categories/access';
import { validateCategoryPayload } from '@/lib/general-affairs/categories/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || '分類操作失敗')
      : String(error || '分類操作失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
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

    const query = (supabase as any)
      .from(config.table)
      .select('*')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const body = await request.json();
    const config = getCategoryConfig(body?.type);
    if (!config) return jsonError('分類類型錯誤', 400);
    if (!await canManageCategory(user.id, config)) return jsonError('沒有分類管理權限', 403);

    const payload = {
      ...validateCategoryPayload(config, body),
      created_by: user.id,
      updated_by: user.id,
    };

    const { data, error } = await (supabase as any)
      .from(config.table)
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
