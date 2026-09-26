import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canAccessPartCatalog, canManageParts } from '@/lib/general-affairs/parts/access';

export const dynamic = 'force-dynamic';

type TargetType = 'EQUIPMENT' | 'EQUIPMENT_TEMPLATE' | 'FACILITY' | 'FACILITY_TEMPLATE';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '相容性操作失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

function normalizeTargetType(value: unknown): TargetType {
  const type = String(value || '').trim().toUpperCase();
  if (type !== 'EQUIPMENT' && type !== 'EQUIPMENT_TEMPLATE' && type !== 'FACILITY' && type !== 'FACILITY_TEMPLATE') throw new Error('相容性對象類型錯誤');
  return type;
}

function normalizeUuid(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} 格式錯誤`);
  }
  return text;
}

function uniqueUuids(values: unknown) {
  if (!Array.isArray(values)) throw new Error('partIds 必須是陣列');
  return Array.from(new Set(values.map((value) => normalizeUuid(value, '料件 id'))));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canAccessPartCatalog()) return jsonError('沒有料件查看權限', 403);

    const { searchParams } = new URL(request.url);
    const targetType = normalizeTargetType(searchParams.get('targetType'));
    const targetId = normalizeUuid(searchParams.get('targetId'), '對象 id');
    const includeInherited = searchParams.get('includeInherited') !== 'false';
    const readSupabase = createAdminClient();

    const { data, error } = await readSupabase
      .from('ga_part_target_compatibilities')
      .select(`
        id,
        target_type,
        target_id,
        part_id,
        notes,
        created_at,
        updated_at,
        part:ga_parts(
          id,
          name,
          part_code,
          brand,
          model,
          specification,
          base_unit,
          category:ga_part_categories(id, name, code)
        )
      `)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) throw error;
    let rows = data || [];
    if (targetType === 'FACILITY' && includeInherited) {
      const { data: facility, error: facilityError } = await readSupabase.from('ga_facilities').select('facility_template_id').eq('id', targetId).is('deleted_at', null).maybeSingle();
      if (facilityError) throw facilityError;
      if (facility?.facility_template_id) {
        const { data: inherited, error: inheritedError } = await readSupabase.from('ga_part_target_compatibilities').select(`id, target_type, target_id, part_id, notes, created_at, updated_at, part:ga_parts(id, name, part_code, brand, model, specification, base_unit, category:ga_part_categories(id, name, code))`).eq('target_type', 'FACILITY_TEMPLATE').eq('target_id', facility.facility_template_id).is('deleted_at', null);
        if (inheritedError) throw inheritedError;
        const directPartIds = new Set(rows.map((row) => row.part_id));
        rows = [...rows, ...(inherited || []).filter((row) => !directPartIds.has(row.part_id)).map((row) => ({ ...row, inherited_from_template: true }))];
      }
    }
    if (targetType === 'EQUIPMENT' && includeInherited) {
      const { data: equipment, error: equipmentError } = await readSupabase.from('ga_equipment').select('template_id').eq('id', targetId).is('deleted_at', null).maybeSingle();
      if (equipmentError) throw equipmentError;
      if (equipment?.template_id) {
        const { data: inherited, error: inheritedError } = await readSupabase.from('ga_part_target_compatibilities').select(`id, target_type, target_id, part_id, notes, created_at, updated_at, part:ga_parts(id, name, part_code, brand, model, specification, base_unit, category:ga_part_categories(id, name, code))`).eq('target_type', 'EQUIPMENT_TEMPLATE').eq('target_id', equipment.template_id).is('deleted_at', null);
        if (inheritedError) throw inheritedError;
        const directPartIds = new Set(rows.map((row) => row.part_id));
        rows = [...rows, ...(inherited || []).filter((row) => !directPartIds.has(row.part_id)).map((row) => ({ ...row, inherited_from_template: true }))];
      }
    }
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    return jsonError(error, error instanceof Error && error.message.includes('格式') ? 400 : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageParts()) return jsonError('沒有料件管理權限', 403);

    const body = await request.json();
    const targetType = normalizeTargetType(body.targetType);
    const targetId = normalizeUuid(body.targetId, '對象 id');
    const partIds = uniqueUuids(body.partIds);

    const { data: existing, error: existingError } = await supabase
      .from('ga_part_target_compatibilities')
      .select('id, part_id')
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .is('deleted_at', null);

    if (existingError) throw existingError;

    const existingRows = existing || [];
    const nextPartIds = new Set(partIds);
    const existingPartIds = new Set(existingRows.map((row) => row.part_id));
    const removeIds = existingRows.filter((row) => !nextPartIds.has(row.part_id)).map((row) => row.id);
    const addPartIds = partIds.filter((partId) => !existingPartIds.has(partId));

    if (removeIds.length > 0) {
      const { error } = await supabase
        .from('ga_part_target_compatibilities')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
          deletion_reason: 'REPLACED_BY_COMPATIBILITY_MANAGEMENT',
          updated_by: user.id,
        })
        .in('id', removeIds);
      if (error) throw error;
    }

    if (addPartIds.length > 0) {
      const { error } = await supabase
        .from('ga_part_target_compatibilities')
        .insert(addPartIds.map((partId) => ({
          target_type: targetType,
          target_id: targetId,
          part_id: partId,
          created_by: user.id,
          updated_by: user.id,
        })));
      if (error) throw error;
    }

    return NextResponse.json({
      success: true,
      data: {
        targetType,
        targetId,
        partIds,
        added: addPartIds.length,
        removed: removeIds.length,
      },
    });
  } catch (error) {
    return jsonError(error, error instanceof Error && error.message.includes('格式') ? 400 : 500);
  }
}
