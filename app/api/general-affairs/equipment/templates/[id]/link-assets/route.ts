import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageEquipment, canManageEquipmentTemplates } from '@/lib/general-affairs/equipment/access';
import { validateUuid } from '@/lib/general-affairs/equipment/validation';

function fail(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '既有設備歸戶失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('未登入', 401);
    if (!await canManageEquipmentTemplates() || !await canManageEquipment()) {
      return fail('需要公司設備型號與據點設備管理權限', 403);
    }

    const templateId = validateUuid(params.id, '公司設備型號 id');
    const body = await request.json();
    const rawIds = Array.isArray(body.equipment_ids) ? body.equipment_ids : [];
    const equipmentIds = Array.from(new Set(rawIds.map((id: unknown) => validateUuid(id, '設備 id'))));
    if (!equipmentIds.length) return fail('請至少選擇一台既有設備', 400);
    if (equipmentIds.length > 100) return fail('單次最多整理 100 台設備', 400);

    const { data: template, error: templateError } = await supabase
      .from('ga_equipment_templates')
      .select('id, category_id, name, brand, model, is_active')
      .eq('id', templateId)
      .is('deleted_at', null)
      .maybeSingle();
    if (templateError) throw templateError;
    if (!template) return fail('找不到公司設備型號', 404);
    if (!template.is_active) return fail('停用的公司設備型號不可用於設備歸戶', 409);

    const { data, error } = await supabase
      .from('ga_equipment')
      .update({
        template_id: template.id,
        category_id: template.category_id,
        name: template.name,
        brand: template.brand,
        model: template.model,
        updated_by: user.id,
      })
      .in('id', equipmentIds)
      .is('template_id', null)
      .is('deleted_at', null)
      .select('id');
    if (error) throw error;

    const linkedCount = data?.length || 0;
    if (!linkedCount) return fail('選取的設備已被其他人歸戶，請重新載入', 409);
    return NextResponse.json({
      success: true,
      data: { linked_count: linkedCount, skipped_count: equipmentIds.length - linkedCount },
      message: `已將 ${linkedCount} 台既有設備歸戶至 ${template.name}`,
    });
  } catch (error) {
    return fail(error);
  }
}
