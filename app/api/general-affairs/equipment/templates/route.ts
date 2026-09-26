import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canManageEquipmentTemplates,
  canReadEquipmentTemplates,
} from '@/lib/general-affairs/equipment/access';
import { validateEquipmentTemplatePayload } from '@/lib/general-affairs/equipment/validation';
import { findDuplicateEquipmentTemplate } from '@/lib/general-affairs/catalog-identity';

export const dynamic = 'force-dynamic';

const TEMPLATE_SORT_COLUMNS = new Set(['name', 'brand', 'model', 'created_at', 'updated_at']);

function errorMessage(error: unknown, fallback = '設備範本操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const resolvedStatus = anyError?.code === '23505' ? 409 : status;
  return NextResponse.json({ success: false, error: errorMessage(error) }, { status: resolvedStatus });
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
    if (!await canReadEquipmentTemplates()) return jsonError('沒有設備範本查看權限', 403);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);
    const sortBy = TEMPLATE_SORT_COLUMNS.has(searchParams.get('sortBy') || '')
      ? searchParams.get('sortBy')!
      : 'updated_at';
    const ascending = searchParams.get('sortDir') === 'asc';

    let query = supabase
      .from('ga_equipment_templates')
      .select(`
        id,
        category_id,
        name,
        brand,
        model,
        description,
        specs,
        default_fields,
        default_warranty_months,
        image_path,
        is_active,
        created_at,
        updated_at,
        category:ga_equipment_categories(id, name, code)
      `, { count: 'exact' })
      .is('deleted_at', null);

    const search = searchParams.get('search')?.trim();
    if (search) {
      query = query.or(`name.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%`);
    }

    const categoryId = searchParams.get('categoryId')?.trim();
    if (categoryId) query = query.eq('category_id', categoryId);

    const active = searchParams.get('active') ?? searchParams.get('isActive');
    if (active === 'true') query = query.eq('is_active', true);
    if (active === 'false') query = query.eq('is_active', false);

    const { data, error, count } = await query
      .order(sortBy, { ascending })
      .range(from, to);

    if (error) throw error;

    const templateIds = (data || []).map((item) => item.id);
    const usageByTemplate = new Map<string, { assetCount: number; storeIds: Set<string> }>();
    if (templateIds.length) {
      const { data: usageRows, error: usageError } = await supabase
        .from('ga_equipment')
        .select('template_id, store_id')
        .in('template_id', templateIds)
        .is('deleted_at', null);
      if (usageError) throw usageError;
      (usageRows || []).forEach((row) => {
        if (!row.template_id) return;
        const usage = usageByTemplate.get(row.template_id) || { assetCount: 0, storeIds: new Set<string>() };
        usage.assetCount += 1;
        if (row.store_id) usage.storeIds.add(row.store_id);
        usageByTemplate.set(row.template_id, usage);
      });
    }
    const rows = (data || []).map((item) => {
      const usage = usageByTemplate.get(item.id);
      return { ...item, asset_count: usage?.assetCount || 0, site_count: usage?.storeIds.size || 0 };
    });

    return NextResponse.json({
      success: true,
      data: rows,
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
    if (!await canManageEquipmentTemplates()) return jsonError('沒有設備範本管理權限', 403);

    const body = await request.json();
    const payload = {
      ...validateEquipmentTemplatePayload(body),
      created_by: user.id,
      updated_by: user.id,
    };

    const { data: existingRows, error: duplicateLookupError } = await supabase
      .from('ga_equipment_templates')
      .select('id, name, brand, model, is_active')
      .is('deleted_at', null);
    if (duplicateLookupError) throw duplicateLookupError;
    const duplicate = findDuplicateEquipmentTemplate(existingRows || [], payload);
    if (duplicate) {
      return NextResponse.json({
        success: false,
        error: `公司設備主檔已存在：${duplicate.name}${duplicate.model ? ` / ${duplicate.model}` : ''}`,
        duplicate,
      }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('ga_equipment_templates')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
