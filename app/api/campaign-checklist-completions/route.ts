import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';
import {
  getCampaignAccessDeniedMessage,
  getCampaignAudienceAccess,
  hasCampaignPublishedAccess,
} from '@/lib/campaign-access';

// =====================================================
// GET /api/campaign-checklist-completions
// 取得門市的 checklist 完成狀態
// =====================================================
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get('campaign_id');
    const store_id = searchParams.get('store_id');

    if (!campaign_id) {
      return NextResponse.json(
        { success: false, error: '缺少 campaign_id 參數' },
        { status: 400 }
      );
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: '找不到活動' }, { status: 404 });
    }

    const access = await getCampaignAudienceAccess(supabase, user.id, campaign);
    const canEdit = await hasPermission(user.id, 'activity.checklist.edit');
    if (!hasCampaignPublishedAccess(access) && !canEdit) {
      return NextResponse.json(
        { success: false, error: getCampaignAccessDeniedMessage(access) },
        { status: 403 }
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

    const shouldLimitToManagedStores =
      !access.canViewAll && !access.canViewAsSupervisor && !access.canViewAsDepartment && access.canViewAsStoreManager;

    if (store_id) {
      if (shouldLimitToManagedStores && !access.managedStoreIds.includes(store_id)) {
        return NextResponse.json({ success: true, data: [] });
      }
      query = query.eq('store_id', store_id);
    } else if (shouldLimitToManagedStores) {
      if (access.managedStoreIds.length === 0) {
        return NextResponse.json({ success: true, data: [] });
      }
      query = query.in('store_id', access.managedStoreIds);
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
    const { checklist_item_id, store_id, is_completed, manager_note, store_assigned_person } = body;

    if (!checklist_item_id || !store_id) {
      return NextResponse.json(
        { success: false, error: '缺少必要欄位' },
        { status: 400 }
      );
    }

    // 先查詢現有記錄，以便合併欄位（避免 upsert 覆蓋未傳入的欄位）
    const { data: existing } = await supabase
      .from('campaign_checklist_completions')
      .select('*')
      .eq('checklist_item_id', checklist_item_id)
      .eq('store_id', store_id)
      .single();

    const completionData: any = {
      checklist_item_id,
      store_id,
      is_completed: is_completed !== undefined ? is_completed : (existing?.is_completed ?? false),
      manager_note: manager_note !== undefined ? manager_note : (existing?.manager_note ?? null),
      store_assigned_person: store_assigned_person !== undefined ? store_assigned_person : (existing?.store_assigned_person ?? null),
    };

    // 若有切換完成狀態，更新完成人員與時間
    if (is_completed !== undefined) {
      if (is_completed) {
        completionData.completed_by = user.id;
        completionData.completed_at = new Date().toISOString();
      } else {
        completionData.completed_by = null;
        completionData.completed_at = null;
      }
    } else if (existing) {
      // 保留現有完成人員與時間
      completionData.completed_by = existing.completed_by;
      completionData.completed_at = existing.completed_at;
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
