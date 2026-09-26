import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canAccessInventoryLocations,
  canManageInventoryLocations,
} from '@/lib/general-affairs/inventory/locations/access';
import { validateInventoryLocationPayload } from '@/lib/general-affairs/inventory/locations/validation';

export const dynamic = 'force-dynamic';

const LOCATION_SORT_COLUMNS = new Set(['name', 'code', 'location_type', 'updated_at', 'created_at']);

function errorMessage(error: unknown, fallback = '庫存位置操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const message = errorMessage(error);
  const isValidationError =
    message.includes('不可由 Client 指定') ||
    message.includes('必須') ||
    message.includes('請輸入') ||
    message.includes('錯誤') ||
    message.includes('不得') ||
    message.includes('不可');
  const resolvedStatus = anyError?.code === '23505' ? 409 : (status === 500 && isValidationError ? 400 : status);
  return NextResponse.json({ success: false, error: message }, { status: resolvedStatus });
}

function getPagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 20) || 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canAccessInventoryLocations()) return jsonError('沒有庫存位置查看權限', 403);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);
    const sortBy = LOCATION_SORT_COLUMNS.has(searchParams.get('sortBy') || '')
      ? searchParams.get('sortBy')!
      : 'updated_at';
    const ascending = searchParams.get('sortOrder') === 'asc';

    let query = supabase
      .from('ga_inventory_locations')
      .select(`
        id,
        code,
        name,
        location_type,
        store_id,
        description,
        is_active,
        allow_negative_stock,
        is_default,
        created_at,
        updated_at,
        store:stores(id, store_code, store_name, short_name)
      `, { count: 'exact' })
      .is('deleted_at', null);

    const search = searchParams.get('search')?.trim();
    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const locationType = searchParams.get('locationType')?.trim();
    if (locationType) query = query.eq('location_type', locationType);

    const storeId = searchParams.get('storeId')?.trim();
    if (storeId) query = query.eq('store_id', storeId);

    const active = searchParams.get('isActive');
    if (active === 'true') query = query.eq('is_active', true);
    if (active === 'false') query = query.eq('is_active', false);

    const { data, error, count } = await query
      .order(sortBy, { ascending })
      .range(from, to);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data || [],
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageInventoryLocations()) return jsonError('沒有庫存位置管理權限', 403);

    const body = await request.json();
    const normalized = validateInventoryLocationPayload(body);

    const { data, error } = await supabase
      .from('ga_inventory_locations')
      .insert(normalized)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
