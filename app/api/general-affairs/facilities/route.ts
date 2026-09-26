import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageFacilities } from '@/lib/general-affairs/facilities/access';
import { validateFacilityPayload } from '@/lib/general-affairs/facilities/validation';

export const dynamic = 'force-dynamic';

const FACILITY_SORT_COLUMNS = new Set([
  'name',
  'facility_code',
  'status',
  'area',
  'updated_at',
  'created_at',
  'installed_at',
  'last_renovated_at',
]);

function withQrScanPath<T extends { qr_token?: string | null }>(facility: T) {
  return {
    ...facility,
    qr_scan_path: facility.qr_token ? `/general-affairs/assets/scan/${facility.qr_token}` : null,
  };
}

function errorMessage(error: unknown, fallback = '設施操作失敗') {
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
    message.includes('格式') ||
    message.includes('錯誤');
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

async function buildFacilityWarnings(supabase: any, facility: any) {
  const warnings = [];

  if (facility?.store_id && facility?.category_id && facility?.name) {
    const normalizedName = String(facility.name).trim();
    const normalizedArea = facility.area || null;
    const normalizedLocation = facility.location_detail || null;

    let query = supabase
      .from('ga_facilities')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', facility.store_id)
      .eq('category_id', facility.category_id)
      .ilike('name', normalizedName)
      .is('deleted_at', null)
      .neq('id', facility.id);

    query = normalizedArea ? query.eq('area', normalizedArea) : query.is('area', null);
    query = normalizedLocation ? query.eq('location_detail', normalizedLocation) : query.is('location_detail', null);

    const { count, error } = await query;
    if (!error && (count || 0) > 0) {
      warnings.push({
        code: 'POSSIBLE_DUPLICATE_FACILITY',
        message: '同門市、分類、名稱、區域與位置已有其他未刪除設施，請確認是否重複建檔。',
        duplicate_count: count || 0,
      });
    }
  }

  return warnings;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);
    const sortBy = FACILITY_SORT_COLUMNS.has(searchParams.get('sortBy') || '')
      ? searchParams.get('sortBy')!
      : 'updated_at';
    const ascending = searchParams.get('sortOrder') === 'asc';

    let query = supabase
      .from('ga_facilities')
      .select(`
        id,
        store_id,
        category_id,
        facility_template_id,
        name,
        facility_code,
        status,
        criticality,
        area,
        location_detail,
        quantity,
        unit,
        is_fixed_asset,
        installed_at,
        purchased_at,
        purchase_unit_amount,
        purchase_amount,
        last_renovated_at,
        description,
        specs,
        tags,
        image_path,
        notes,
        qr_token,
        qr_token_issued_at,
        qr_token_revoked_at,
        created_at,
        updated_at,
        store:stores(id, store_code, store_name, short_name),
        category:ga_facility_categories(id, name, code),
        template:ga_facility_templates(id, code, name, brand, model)
      `, { count: 'exact' })
      .is('deleted_at', null);

    const search = searchParams.get('search')?.trim();
    if (search) {
      query = query.or(`name.ilike.%${search}%,facility_code.ilike.%${search}%,area.ilike.%${search}%,location_detail.ilike.%${search}%`);
    }

    const storeId = searchParams.get('storeId')?.trim();
    if (storeId) query = query.eq('store_id', storeId);

    const templateId = searchParams.get('templateId')?.trim();
    if (templateId) query = query.eq('facility_template_id', templateId);

    const categoryId = searchParams.get('categoryId')?.trim();
    if (categoryId) query = query.eq('category_id', categoryId);

    const status = searchParams.get('status')?.trim();
    if (status) query = query.eq('status', status);

    const area = searchParams.get('area')?.trim();
    if (area) query = query.eq('area', area);

    const { data, error, count } = await query
      .order(sortBy, { ascending })
      .range(from, to);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: (data || []).map(withQrScanPath),
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
    if (!await canManageFacilities()) return jsonError('沒有設施管理權限', 403);

    const body = await request.json();
    const normalized = validateFacilityPayload(body);

    const { data, error } = await supabase
      .from('ga_facilities')
      .insert(normalized)
      .select('*')
      .single();

    if (error) throw error;

    const warnings = await buildFacilityWarnings(supabase, data);
    return NextResponse.json({ success: true, data: withQrScanPath(data), warnings }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
