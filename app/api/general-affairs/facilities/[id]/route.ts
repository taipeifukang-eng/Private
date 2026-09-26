import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageFacilities } from '@/lib/general-affairs/facilities/access';
import {
  validateDeletionReason,
  validateFacilityPayload,
  validateUuid,
} from '@/lib/general-affairs/facilities/validation';

export const dynamic = 'force-dynamic';

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

async function buildFacilityWarnings(supabase: any, facility: any) {
  const warnings = [];

  if (facility?.store_id && facility?.category_id && facility?.name) {
    let query = supabase
      .from('ga_facilities')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', facility.store_id)
      .eq('category_id', facility.category_id)
      .ilike('name', String(facility.name).trim())
      .is('deleted_at', null)
      .neq('id', facility.id);

    query = facility.area ? query.eq('area', facility.area) : query.is('area', null);
    query = facility.location_detail ? query.eq('location_detail', facility.location_detail) : query.is('location_detail', null);

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

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const id = validateUuid(params.id, '設施 id');
    const { data, error } = await supabase
      .from('ga_facilities')
      .select(`
        *,
        store:stores(id, store_code, store_name, short_name),
        category:ga_facility_categories(id, name, code)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    const warnings = await buildFacilityWarnings(supabase, data);
    return NextResponse.json({ success: true, data, warnings });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageFacilities()) return jsonError('沒有設施管理權限', 403);

    const id = validateUuid(params.id, '設施 id');
    const body = await request.json();
    const normalized = validateFacilityPayload(body, { partial: true });
    const payload = {
      ...normalized,
      ...(normalized.status === 'RETIRED' ? { qr_token_revoked_at: new Date().toISOString() } : {}),
    };

    const { data, error } = await supabase
      .from('ga_facilities')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;

    const warnings = await buildFacilityWarnings(supabase, data);
    return NextResponse.json({ success: true, data, warnings });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageFacilities()) return jsonError('沒有設施管理權限', 403);

    const id = validateUuid(params.id, '設施 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body?.deletion_reason);

    const { data: result, error } = await supabase.rpc('ga_soft_delete_facility', {
      p_facility_id: id,
      p_reason: reason,
    });

    if (error) throw error;
    if (!result?.ok) {
      return jsonError(result?.error || '設施刪除失敗', Number(result?.status || 500));
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return jsonError(error);
  }
}
