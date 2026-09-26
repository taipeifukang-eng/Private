import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessPartCatalog, canManageParts } from '@/lib/general-affairs/parts/access';
import {
  validateDeletionReason,
  validatePartPayload,
  validateUuid,
} from '@/lib/general-affairs/parts/validation';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback = '料件操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string; details?: string };
  const message = errorMessage(error);
  const isNotFound = anyError?.code === 'PGRST116';
  const isValidationError =
    message.includes('不可由 Client 指定') ||
    message.includes('必須') ||
    message.includes('請輸入') ||
    message.includes('格式') ||
    message.includes('錯誤') ||
    message.includes('路徑');
  const resolvedStatus = isNotFound ? 404 : (anyError?.code === '23505' ? 409 : (status === 500 && isValidationError ? 400 : status));
  return NextResponse.json({ success: false, error: isNotFound ? '找不到料件' : message }, { status: resolvedStatus });
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

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canAccessPartCatalog()) return jsonError('沒有料件查看權限', 403);

    const id = validateUuid(params.id, '料件 id');
    const { data, error } = await supabase
      .from('ga_parts')
      .select(`
        *,
        category:ga_part_categories(id, name, code),
        compatibilities:ga_part_compatibilities(
          id,
          compatibility_type,
          equipment_template_id,
          vendor_name,
          series_name,
          brand,
          model,
          notes,
          created_at,
          updated_at,
          equipment_template:ga_equipment_templates(id, name, brand, model)
        )
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    const warnings = await buildPartWarnings(supabase, data);
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
    if (!await canManageParts()) return jsonError('沒有料件管理權限', 403);

    const id = validateUuid(params.id, '料件 id');
    const body = await request.json();
    const normalized = validatePartPayload(body, { partial: true });

    const { data, error } = await supabase
      .from('ga_parts')
      .update(normalized)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (error) throw error;

    const warnings = await buildPartWarnings(supabase, data);
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
    if (!await canManageParts()) return jsonError('沒有料件管理權限', 403);

    const id = validateUuid(params.id, '料件 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body?.deletion_reason);

    const { data: result, error } = await supabase.rpc('ga_soft_delete_part', {
      p_part_id: id,
      p_reason: reason,
    });

    if (error) throw error;
    if (!result?.ok) {
      return jsonError(result?.error || '料件刪除失敗', Number(result?.status || 500));
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return jsonError(error);
  }
}
