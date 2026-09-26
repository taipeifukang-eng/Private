import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessPartCatalog, canManageParts } from '@/lib/general-affairs/parts/access';
import {
  validatePartCompatibilityPayload,
  validateUuid,
} from '@/lib/general-affairs/parts/validation';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const message = error instanceof Error ? error.message : String(error || '料件相容性操作失敗');
  const isValidationError =
    message.includes('不可由 Client 指定') ||
    message.includes('必須') ||
    message.includes('請輸入') ||
    message.includes('格式') ||
    message.includes('錯誤');
  const resolvedStatus = anyError?.code === '23505' ? 409 : (status === 500 && isValidationError ? 400 : status);
  return NextResponse.json({ success: false, error: message }, { status: resolvedStatus });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canAccessPartCatalog()) return jsonError('沒有料件查看權限', 403);

    const partId = validateUuid(params.id, '料件 id');
    const { data, error } = await supabase
      .from('ga_part_compatibilities')
      .select(`
        id,
        part_id,
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
      `)
      .eq('part_id', partId)
      .is('deleted_at', null)
      .order('compatibility_type', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageParts()) return jsonError('沒有料件管理權限', 403);

    const partId = validateUuid(params.id, '料件 id');
    const body = await request.json();
    const normalized = validatePartCompatibilityPayload(body, { partId });

    const { data, error } = await supabase
      .from('ga_part_compatibilities')
      .insert(normalized)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
