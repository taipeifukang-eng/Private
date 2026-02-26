import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

// =====================================================
// GET /api/campaign-checklist-items
// 取得活動的 checklist 項目列表
// =====================================================
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get('campaign_id');

    if (!campaign_id) {
      return NextResponse.json(
        { success: false, error: '缺少 campaign_id 參數' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('campaign_checklist_items')
      .select('*')
      .eq('campaign_id', campaign_id)
      .order('item_order', { ascending: true });

    if (error) {
      // 42P01 = table doesn't exist (未執行 migration)
      if (error.code === '42P01') {
        return NextResponse.json({ success: true, data: [] });
      }
      console.error('Error fetching checklist items:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('Error in GET /api/campaign-checklist-items:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// =====================================================
// POST /api/campaign-checklist-items
// 新增 checklist 項目（需要編輯權限）
// =====================================================
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 取得當前用戶 ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }
    
    // 檢查權限
    const canEdit = await hasPermission(user.id, 'activity.checklist.edit');
    if (!canEdit) {
      return NextResponse.json(
        { success: false, error: '沒有編輯 checklist 的權限' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { campaign_id, task_name, notes, assigned_person, deadline, item_order } = body;

    if (!campaign_id || !task_name) {
      return NextResponse.json(
        { success: false, error: '缺少必要欄位' },
        { status: 400 }
      );
    }

    // 如果沒有提供 item_order，自動計算下一個順序
    let finalOrder = item_order;
    if (finalOrder === undefined || finalOrder === null) {
      const { data: existingItems } = await supabase
        .from('campaign_checklist_items')
        .select('item_order')
        .eq('campaign_id', campaign_id)
        .order('item_order', { ascending: false })
        .limit(1);
      
      finalOrder = existingItems && existingItems.length > 0 
        ? existingItems[0].item_order + 1 
        : 0;
    }

    const { data, error } = await supabase
      .from('campaign_checklist_items')
      .insert({
        campaign_id,
        task_name,
        notes: notes || '',
        assigned_person: assigned_person || '',
        deadline: deadline || '',
        item_order: finalOrder,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating checklist item:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error in POST /api/campaign-checklist-items:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// =====================================================
// PUT /api/campaign-checklist-items
// 更新 checklist 項目（需要編輯權限）
// =====================================================
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 取得當前用戶 ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }
    
    // 檢查權限
    const canEdit = await hasPermission(user.id, 'activity.checklist.edit');
    if (!canEdit) {
      return NextResponse.json(
        { success: false, error: '沒有編輯 checklist 的權限' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { id, task_name, notes, assigned_person, deadline, item_order } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: '缺少 id 參數' },
        { status: 400 }
      );
    }

    const updateData: any = {
      updated_by: user.id,
    };

    if (task_name !== undefined) updateData.task_name = task_name;
    if (notes !== undefined) updateData.notes = notes;
    if (assigned_person !== undefined) updateData.assigned_person = assigned_person;
    if (deadline !== undefined) updateData.deadline = deadline;
    if (item_order !== undefined) updateData.item_order = item_order;

    const { data, error } = await supabase
      .from('campaign_checklist_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating checklist item:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error in PUT /api/campaign-checklist-items:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// =====================================================
// DELETE /api/campaign-checklist-items
// 刪除 checklist 項目（需要編輯權限）
// =====================================================
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 取得當前用戶 ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }
    
    // 檢查權限
    const canEdit = await hasPermission(user.id, 'activity.checklist.edit');
    if (!canEdit) {
      return NextResponse.json(
        { success: false, error: '沒有編輯 checklist 的權限' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: '缺少 id 參數' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('campaign_checklist_items')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting checklist item:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in DELETE /api/campaign-checklist-items:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
