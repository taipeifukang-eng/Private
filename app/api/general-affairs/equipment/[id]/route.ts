import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageEquipment } from '@/lib/general-affairs/equipment/access';
import {
  validateDeletionReason,
  validateEquipmentPayload,
  validateUuid,
} from '@/lib/general-affairs/equipment/validation';

export const dynamic = 'force-dynamic';

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

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const id = validateUuid(params.id, '設備 id');
    const { data, error } = await supabase
      .from('ga_equipment')
      .select(`
        *,
        store:stores(id, store_code, store_name, short_name),
        category:ga_equipment_categories(id, name, code),
        template:ga_equipment_templates(id, name, brand, model)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    const warnings = await buildEquipmentWarnings(supabase, data);
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
    if (!await canManageEquipment()) return jsonError('沒有設備管理權限', 403);

    const id = validateUuid(params.id, '設備 id');
    const body = await request.json();
    const normalized = validateEquipmentPayload(body, { partial: true });
    const payload = {
      ...normalized,
      ...(normalized.has_warranty === false ? { warranty_end_date: null } : {}),
      ...(normalized.status === 'SCRAPPED' ? { qr_token_revoked_at: new Date().toISOString() } : {}),
      updated_by: user.id,
    };

    const { data, error } = await supabase
      .from('ga_equipment')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;

    const warnings = await buildEquipmentWarnings(supabase, data);
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
    if (!await canManageEquipment()) return jsonError('沒有設備管理權限', 403);

    const id = validateUuid(params.id, '設備 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body?.deletion_reason);
    const { data: result, error } = await supabase.rpc('ga_soft_delete_equipment', {
      p_equipment_id: id,
      p_deletion_reason: reason,
    });

    if (error) throw error;
    if (!result?.ok) {
      return jsonError(result?.error || '設備刪除失敗', Number(result?.status || 500));
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return jsonError(error);
  }
}
