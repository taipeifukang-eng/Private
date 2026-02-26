import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// =====================================================
// GET /api/campaign-checklist-completions
// 取得門市的 checklist 完成狀態
// =====================================================
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get('campaign_id');
    const store_id = searchParams.get('store_id');

    if (!campaign_id) {
      return NextResponse.json(
        { success: false, error: '缺少 campaign_id 參數' },
        { status: 400 }
      );
    }

    // 查詢所有 checklist 項目
    const { data: items, error: itemsError } = await supabase
      .from('campaign_checklist_items')
      .select('id')
      .eq('campaign_id', campaign_id);

    if (itemsError) {
      // 42P01 = table doesn't exist (未執行 migration)
      if (itemsError.code === '42P01') {
        return NextResponse.json({ success: true, data: [] });
      }
      console.error('Error fetching checklist items:', itemsError);
      return NextResponse.json(
        { success: false, error: itemsError.message },
        { status: 500 }
      );
    }

    const itemIds = (items || []).map(item => item.id);

    if (itemIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 查詢完成狀態
    let query = supabase
      .from('campaign_checklist_completions')
      .select('*')
      .in('checklist_item_id', itemIds);

    if (store_id) {
      query = query.eq('store_id', store_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching checklist completions:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('Error in GET /api/campaign-checklist-completions:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// =====================================================
// POST /api/campaign-checklist-completions
// 更新 checklist 完成狀態（店長可打勾）
// =====================================================
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查用戶是否登入
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { checklist_item_id, store_id, is_completed } = body;

    if (!checklist_item_id || !store_id) {
      return NextResponse.json(
        { success: false, error: '缺少必要欄位' },
        { status: 400 }
      );
    }

    // 檢查用戶是否是該門市的店長/督導
    // （這裡可以加入更嚴格的權限檢查，例如查詢 store_managers 表）
    // 目前先允許所有登入用戶操作（由前端控制顯示）

    const completionData: any = {
      checklist_item_id,
      store_id,
      is_completed: is_completed ?? true,
    };

    if (is_completed) {
      completionData.completed_by = user.id;
      completionData.completed_at = new Date().toISOString();
    } else {
      completionData.completed_by = null;
      completionData.completed_at = null;
    }

    // 使用 UPSERT 邏輯
    const { data, error } = await supabase
      .from('campaign_checklist_completions')
      .upsert(completionData, {
        onConflict: 'checklist_item_id,store_id',
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating checklist completion:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error in POST /api/campaign-checklist-completions:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
