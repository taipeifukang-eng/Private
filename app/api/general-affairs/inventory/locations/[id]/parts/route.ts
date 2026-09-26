import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessInventoryLocations, canManageInventoryLocations } from '@/lib/general-affairs/inventory/locations/access';
import { canReadParts } from '@/lib/general-affairs/parts/access';
import {
  validateInventoryLocationPartPayload,
  validateUuid,
} from '@/lib/general-affairs/inventory/locations/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const message = error instanceof Error ? error.message : String(error || '位置料件設定操作失敗');
  const isValidationError =
    message.includes('不可由 Client 指定') ||
    message.includes('必須') ||
    message.includes('請輸入') ||
    message.includes('錯誤') ||
    message.includes('不可') ||
    message.includes('不得');
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

function attachResolvedUnit(rows: any[]) {
  return rows.map((row) => ({
    ...row,
    resolvedPreferredIssueUnit:
      row.preferred_issue_unit_type === 'BASE'
        ? row.part?.base_unit || null
        : row.preferred_issue_unit_type === 'PURCHASE'
          ? row.part?.purchase_unit || null
          : null,
  }));
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canAccessInventoryLocations()) return jsonError('沒有庫存位置查看權限', 403);

    const locationId = validateUuid(params.id, '庫存位置 id');
    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);

    let query = supabase
      .from('ga_inventory_location_parts')
      .select(`
        id,
        location_id,
        part_id,
        is_active,
        safety_stock_qty,
        reorder_point_qty,
        maximum_stock_qty,
        preferred_issue_unit_type,
        notes,
        created_at,
        updated_at,
        part:ga_parts(
          id,
          category_id,
          name,
          part_code,
          barcode,
          brand,
          model,
          specification,
          base_unit,
          purchase_unit,
          purchase_to_base_rate,
          category:ga_part_categories(id, name, code)
        )
      `, { count: 'exact' })
      .eq('location_id', locationId)
      .is('deleted_at', null);

    const partId = searchParams.get('partId')?.trim();
    if (partId) query = query.eq('part_id', partId);

    const active = searchParams.get('isActive');
    if (active === 'true') query = query.eq('is_active', true);
    if (active === 'false') query = query.eq('is_active', false);

    const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, to);
    if (error) throw error;

    let rows = attachResolvedUnit(data || []);

    const categoryId = searchParams.get('categoryId')?.trim();
    if (categoryId) rows = rows.filter((row) => row.part?.category_id === categoryId);

    const search = searchParams.get('search')?.trim().toLowerCase();
    if (search) {
      rows = rows.filter((row) => [
        row.part?.name,
        row.part?.part_code,
        row.part?.barcode,
        row.part?.brand,
        row.part?.model,
        row.part?.specification,
      ].some((value) => String(value || '').toLowerCase().includes(search)));
    }

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

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageInventoryLocations()) return jsonError('沒有庫存位置管理權限', 403);
    if (!await canReadParts()) return jsonError('缺少 general_affairs.part.view，因此無法新增位置料件設定。', 403);

    const locationId = validateUuid(params.id, '庫存位置 id');
    const body = await request.json();
    const normalized = validateInventoryLocationPartPayload(body, { locationId });

    const { data, error } = await supabase
      .from('ga_inventory_location_parts')
      .insert(normalized)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
