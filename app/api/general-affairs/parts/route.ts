import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessPartCatalog, canManageParts } from '@/lib/general-affairs/parts/access';
import { validatePartPayload } from '@/lib/general-affairs/parts/validation';

export const dynamic = 'force-dynamic';

const PART_SORT_COLUMNS = new Set([
  'name',
  'part_code',
  'barcode',
  'brand',
  'model',
  'updated_at',
  'created_at',
]);

function errorMessage(error: unknown, fallback = '料件操作失敗') {
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
    message.includes('錯誤') ||
    message.includes('路徑');
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

async function buildPartWarnings(supabase: any, part: any) {
  const warnings = [];

  if (part?.brand && part?.model && part?.specification) {
    const { count, error } = await supabase
      .from('ga_parts')
      .select('id', { count: 'exact', head: true })
      .eq('brand', part.brand)
      .eq('model', part.model)
      .eq('specification', part.specification)
      .is('deleted_at', null)
      .neq('id', part.id);

    if (!error && (count || 0) > 0) {
      warnings.push({
        code: 'POSSIBLE_DUPLICATE_PART',
        message: '相同品牌、型號與規格已有其他未刪除料件，請確認是否重複建檔。',
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
    if (!await canAccessPartCatalog()) return jsonError('沒有料件查看權限', 403);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);
    const sortBy = PART_SORT_COLUMNS.has(searchParams.get('sortBy') || '')
      ? searchParams.get('sortBy')!
      : 'updated_at';
    const ascending = searchParams.get('sortOrder') === 'asc';

    let query = supabase
      .from('ga_parts')
      .select(`
        id,
        category_id,
        name,
        part_code,
        barcode,
        brand,
        model,
        specification,
        description,
        base_unit,
        purchase_unit,
        purchase_to_base_rate,
        minimum_issue_qty,
        allow_fractional_issue,
        allow_unpacking,
        image_path,
        specs,
        tags,
        is_active,
        notes,
        created_at,
        updated_at,
        category:ga_part_categories(id, name, code)
      `, { count: 'exact' })
      .is('deleted_at', null);

    const search = searchParams.get('search')?.trim();
    if (search) {
      query = query.or(`name.ilike.%${search}%,part_code.ilike.%${search}%,barcode.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%,specification.ilike.%${search}%`);
    }

    const categoryId = searchParams.get('categoryId')?.trim();
    if (categoryId) query = query.eq('category_id', categoryId);

    const brand = searchParams.get('brand')?.trim();
    if (brand) query = query.ilike('brand', brand);

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
    if (!await canManageParts()) return jsonError('沒有料件管理權限', 403);

    const body = await request.json();
    const normalized = validatePartPayload(body);

    const { data, error } = await supabase
      .from('ga_parts')
      .insert(normalized)
      .select('*')
      .single();

    if (error) throw error;

    const warnings = await buildPartWarnings(supabase, data);
    return NextResponse.json({ success: true, data, warnings }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
