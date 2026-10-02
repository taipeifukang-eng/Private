import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageEquipment } from '@/lib/general-affairs/equipment/access';
import { validateEquipmentPayload } from '@/lib/general-affairs/equipment/validation';

export const dynamic = 'force-dynamic';

const EQUIPMENT_SORT_COLUMNS = new Set(['name', 'asset_code', 'status', 'updated_at', 'created_at', 'warranty_end_date']);

const EQUIPMENT_LIST_SELECT: string = `
  id,
  store_id,
  category_id,
  template_id,
  name,
  asset_code,
  barcode,
  brand,
  model,
  serial_number,
  status,
  criticality,
  onboarding_status,
  onboarding_review_note,
  onboarding_reviewed_at,
  onboarding_reviewed_by,
  area,
  location_detail,
  purpose,
  installed_at,
  purchased_at,
  activated_at,
  purchase_amount,
  specs,
  tags,
  notes,
  has_warranty,
  warranty_end_date,
  image_path,
  created_at,
  updated_at,
  store:stores(id, store_code, store_name, short_name),
  category:ga_equipment_categories(id, name, code),
  template:ga_equipment_templates(id, name, brand, model)
`;

const EQUIPMENT_QR_SELECT: string = `
  ${EQUIPMENT_LIST_SELECT},
  qr_token,
  qr_token_issued_at,
  qr_token_revoked_at
`;

function isMissingEquipmentQrSchema(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes('ga_equipment')
    && ['qr_token', 'qr_token_issued_at', 'qr_token_revoked_at'].some(column => message.includes(column))
    && (message.includes('does not exist') || message.includes('schema cache'));
}

function withQrScanPath<T extends { qr_token?: string | null }>(equipment: T) {
  return {
    ...equipment,
    qr_scan_path: equipment.qr_token ? `/general-affairs/assets/scan/${equipment.qr_token}` : null,
  };
}

function errorMessage(error: unknown, fallback = '設備操作失敗') {
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

async function buildEquipmentWarnings(supabase: any, equipment: any) {
  const warnings = [];

  if (equipment?.has_warranty === true && !equipment?.warranty_end_date) {
    warnings.push({
      code: 'WARRANTY_INCOMPLETE',
      message: '此設備標記為有保固，但尚未填寫保固到期日。',
    });
  }

  if (equipment?.brand && equipment?.model && equipment?.serial_number) {
    const { count, error } = await supabase
      .from('ga_equipment')
      .select('id', { count: 'exact', head: true })
      .eq('brand', equipment.brand)
      .eq('model', equipment.model)
      .eq('serial_number', equipment.serial_number)
      .is('deleted_at', null)
      .neq('id', equipment.id);

    if (!error && (count || 0) > 0) {
      warnings.push({
        code: 'POSSIBLE_DUPLICATE_SERIAL',
        message: '同品牌、型號、序號已有其他未刪除設備，請確認是否重複建檔。',
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
    const sortBy = EQUIPMENT_SORT_COLUMNS.has(searchParams.get('sortBy') || '')
      ? searchParams.get('sortBy')!
      : 'updated_at';
    const ascending = searchParams.get('sortDir') === 'asc';

    const search = searchParams.get('search')?.trim();
    const storeId = searchParams.get('storeId')?.trim();
    const templateId = searchParams.get('templateId')?.trim();
    const categoryId = searchParams.get('categoryId')?.trim();
    const status = searchParams.get('status')?.trim();
    const onboardingStatus = searchParams.get('onboardingStatus')?.trim();

    const runEquipmentQuery = async (includeQrFields: boolean) => {
      let query = supabase
        .from('ga_equipment')
        .select(includeQrFields ? EQUIPMENT_QR_SELECT : EQUIPMENT_LIST_SELECT, { count: 'exact' })
        .is('deleted_at', null);

      if (search) {
        query = query.or(`name.ilike.%${search}%,asset_code.ilike.%${search}%,barcode.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%,serial_number.ilike.%${search}%`);
      }
      if (storeId) query = query.eq('store_id', storeId);
      if (templateId) query = query.eq('template_id', templateId);
      if (searchParams.get('templateStatus') === 'unlinked') query = query.is('template_id', null);
      if (categoryId) query = query.eq('category_id', categoryId);
      if (status) query = query.eq('status', status);
      if (onboardingStatus) query = query.eq('onboarding_status', onboardingStatus);

      return query.order(sortBy, { ascending }).range(from, to);
    };

    let result = await runEquipmentQuery(true);
    if (result.error && isMissingEquipmentQrSchema(result.error)) {
      result = await runEquipmentQuery(false);
    }

    const { data, error, count } = result;

    if (error) throw error;
    const equipmentRows = (data || []) as unknown as Array<Record<string, unknown> & { qr_token?: string | null }>;

    return NextResponse.json({
      success: true,
      data: equipmentRows.map(withQrScanPath),
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
    if (!await canManageEquipment()) return jsonError('沒有設備管理權限', 403);

    const body = await request.json();
    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return jsonError('新增數量必須是 1 至 100 的整數', 400);
    }
    const normalized = validateEquipmentPayload(body);
    const payload = {
      ...normalized,
      ...(normalized.has_warranty === false ? { warranty_end_date: null } : {}),
      created_by: user.id,
      updated_by: user.id,
    };

    const rows = Array.from({ length: quantity }, () => ({
      ...payload,
      ...(quantity > 1 ? {
        serial_number: null,
        barcode: null,
        onboarding_status: 'NEEDS_EQUIPMENT_PHOTO',
      } : {}),
    }));

    const { data, error } = await supabase
      .from('ga_equipment')
      .insert(rows)
      .select('*');

    if (error) throw error;

    const created = data || [];
    const primary = created[0];
    const warnings = quantity === 1 && primary ? await buildEquipmentWarnings(supabase, primary) : [];
    return NextResponse.json({
      success: true,
      data: primary ? withQrScanPath(primary) : null,
      items: created.map(withQrScanPath),
      createdCount: created.length,
      warnings,
    }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
