import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

// PUT: 更新模板項目
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const permission = await requirePermission(user.id, 'inspection.template.manage');
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.message || '無權限' }, { status: 403 });
    }

    const body = await request.json();
    const {
      section,
      section_name,
      section_order,
      item_name,
      item_description,
      item_order,
      max_score,
      scoring_type,
      checklist_items,
      is_active,
    } = body;

    const updateData: any = { updated_at: new Date().toISOString() };
    if (section !== undefined) updateData.section = section;
    if (section_name !== undefined) updateData.section_name = section_name;
    if (section_order !== undefined) updateData.section_order = section_order;
    if (item_name !== undefined) updateData.item_name = item_name;
    if (item_description !== undefined) updateData.item_description = item_description;
    if (item_order !== undefined) updateData.item_order = item_order;
    if (max_score !== undefined) updateData.max_score = max_score;
    if (scoring_type !== undefined) updateData.scoring_type = scoring_type;
    if (checklist_items !== undefined) updateData.checklist_items = checklist_items;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from('inspection_templates')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ template: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE: 刪除模板項目（軟刪除 - 設為 inactive）
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const permission = await requirePermission(user.id, 'inspection.template.manage');
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.message || '無權限' }, { status: 403 });
    }

    // 軟刪除：設定 is_active = false
    const { error } = await supabase
      .from('inspection_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', params.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
