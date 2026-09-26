import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canManageEquipmentTemplates,
  canReadEquipmentTemplates,
} from '@/lib/general-affairs/equipment/access';
import {
  validateDeletionReason,
  validateEquipmentTemplatePayload,
  validateUuid,
} from '@/lib/general-affairs/equipment/validation';
import { findDuplicateEquipmentTemplate } from '@/lib/general-affairs/catalog-identity';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback = '設備範本操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500, details?: Record<string, unknown>) {
  const anyError = error as { code?: string };
  const resolvedStatus = anyError?.code === '23505' ? 409 : status;
  return NextResponse.json({ success: false, error: errorMessage(error), ...(details || {}) }, { status: resolvedStatus });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canReadEquipmentTemplates()) return jsonError('沒有設備範本查看權限', 403);

    const id = validateUuid(params.id, '設備範本 id');
    const { data, error } = await supabase
      .from('ga_equipment_templates')
      .select('*, category:ga_equipment_categories(id, name, code)')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

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
    if (!await canManageEquipmentTemplates()) return jsonError('沒有設備範本管理權限', 403);

    const id = validateUuid(params.id, '設備範本 id');
    const body = await request.json();
    const payload = {
      ...validateEquipmentTemplatePayload(body, { partial: true }),
      updated_by: user.id,
    };

    const { data: existingRows, error: duplicateLookupError } = await supabase
      .from('ga_equipment_templates')
      .select('id, name, brand, model, is_active')
      .is('deleted_at', null);
    if (duplicateLookupError) throw duplicateLookupError;
    const current = (existingRows || []).find((row) => row.id === id);
    const duplicate = findDuplicateEquipmentTemplate(
      existingRows || [],
      { ...current, ...payload },
      id,
    );
    if (duplicate) {
      return NextResponse.json({
        success: false,
        error: `公司設備主檔已存在：${duplicate.name}${duplicate.model ? ` / ${duplicate.model}` : ''}`,
        duplicate,
      }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('ga_equipment_templates')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageEquipmentTemplates()) return jsonError('沒有設備範本管理權限', 403);

    const id = validateUuid(params.id, '設備範本 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body?.deletion_reason);
    const { data: result, error } = await supabase.rpc('ga_soft_delete_equipment_template', {
      p_template_id: id,
      p_deletion_reason: reason,
    });

    if (error) throw error;
    if (!result?.ok) {
      return jsonError(result?.error || '設備範本刪除失敗', Number(result?.status || 500));
    }

    return NextResponse.json({ success: true, data: result.data, warning: result.warning || null });
  } catch (error) {
    return jsonError(error);
  }
}
