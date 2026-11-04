import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  authorizeCampaignStoreWrite,
  CAMPAIGN_PERM,
  getCampaignAccessDeniedMessage,
  getCampaignAudienceAccess,
  hasAnyPermission,
  hasCampaignScopeBypass,
  getCampaignStoreScope,
  hasCampaignPublishedAccess,
} from '@/lib/campaign-access';

export const dynamic = 'force-dynamic';

/**
 * 支援人員寫入檢查：持 activity.manage 者可寫全部；
 * 否則請求門市或支援門市其中任一間須是本人被任命門市（督導依活動檢視範圍）。
 */
async function authorizeSupportStaffWrite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  campaignId: string,
  storeIds: string[]
) {
  let last: Awaited<ReturnType<typeof authorizeCampaignStoreWrite>> = {
    ok: false,
    status: 403,
    error: '權限不足',
  };
  for (const storeId of storeIds) {
    last = await authorizeCampaignStoreWrite(
      supabase,
      userId,
      campaignId,
      [storeId],
      [],
      [],
      // RLS 寫入 policy 只認 activity.manage / support_assign.edit；未任命者讀不到資料，不另開例外
      [CAMPAIGN_PERM.supportAssignEdit]
    );
    if (last.ok) return last;
  }
  return last;
}

/**
 * GET /api/campaign-support-staff
 * 取得支援人員指派
 * Query params: campaign_id (required), support_request_id (optional), supporting_store_id (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const campaignId = searchParams.get('campaign_id');
    const supportRequestId = searchParams.get('support_request_id');
    const supportingStoreId = searchParams.get('supporting_store_id');

    if (!campaignId) {
      return NextResponse.json({ success: false, error: '缺少 campaign_id' }, { status: 400 });
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();
    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: '找不到活動' }, { status: 404 });
    }

    const access = await getCampaignAudienceAccess(supabase, user.id, campaign);
    // support_assign.edit 為店長層級，僅通過閘門；只有 activity.manage 維持看全部
    const canBypassScope = await hasCampaignScopeBypass(user.id, []);
    // 輔助權限（support_*.edit / staff_overview.view）不再單獨放行：仍須通過發布閘門（view_own/view_all），
    // 草稿活動只有 view_all 或 activity.manage 可讀
    if (!hasCampaignPublishedAccess(access) && !canBypassScope) {
      return NextResponse.json(
        { success: false, error: getCampaignAccessDeniedMessage(access) },
        { status: 403 }
      );
    }
    // 店長只能看「請求門市」或「支援門市」是自己被任命門市的資料
    const scope = getCampaignStoreScope(access, canBypassScope);

    let query = supabase
      .from('campaign_support_staff')
      .select(`
        *,
        requesting_store:stores!campaign_support_staff_requesting_store_id_fkey(id, store_code, store_name),
        supporting_store:stores!campaign_support_staff_supporting_store_id_fkey(id, store_code, store_name)
      `)
      .eq('campaign_id', campaignId)
      .order('sort_order')
      .order('created_at');

    if (!scope.all) {
      if (scope.storeIds.length === 0) return NextResponse.json({ success: true, data: [] });
      const idList = scope.storeIds.join(',');
      query = query.or(`requesting_store_id.in.(${idList}),supporting_store_id.in.(${idList})`);
    }
    if (supportRequestId) {
      query = query.eq('support_request_id', supportRequestId);
    }
    if (supportingStoreId) {
      query = query.eq('supporting_store_id', supportingStoreId);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ success: true, data: [] });
      console.error('Error fetching support staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/campaign-support-staff
 * 新增或批量替換支援人員
 * Body: { support_request_id, campaign_id, supporting_store_id, requesting_store_id, staff: [...] }
 * 或 { support_request_id, ..., employee_code, employee_name, position } 單筆
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { support_request_id, campaign_id, supporting_store_id, requesting_store_id, staff, replace } = body;

    if (!support_request_id || !campaign_id || !supporting_store_id || !requesting_store_id) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    // 指派支援人員的是「支援門市」的店長；請求門市端同樣視為有關係的門市
    const auth = await authorizeSupportStaffWrite(supabase, user.id, campaign_id, [
      supporting_store_id,
      requesting_store_id,
    ]);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    if (replace && Array.isArray(staff)) {
      // 批量替換
      await supabase
        .from('campaign_support_staff')
        .delete()
        .eq('support_request_id', support_request_id);

      if (staff.length === 0) {
        return NextResponse.json({ success: true, data: [] });
      }

      const insertData = staff.map((s: any, index: number) => ({
        support_request_id,
        campaign_id,
        supporting_store_id,
        requesting_store_id,
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        position: s.position || null,
        sort_order: index,
        created_by: user.id,
      }));

      const { data, error } = await supabase
        .from('campaign_support_staff')
        .insert(insertData)
        .select();

      if (error) {
        console.error('Error replacing support staff:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data: data || [] });
    }

    // 單筆新增
    const { employee_code, employee_name, position, sort_order } = body;
    if (!employee_code || !employee_name) {
      return NextResponse.json({ success: false, error: '缺少員工資料' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('campaign_support_staff')
      .insert({
        support_request_id,
        campaign_id,
        supporting_store_id,
        requesting_store_id,
        employee_code,
        employee_name,
        position: position || null,
        sort_order: sort_order || 0,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting support staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaign-support-staff
 * 刪除支援人員
 * Body: { id }
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from('campaign_support_staff')
      .select('campaign_id, supporting_store_id, requesting_store_id')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: '找不到支援人員' }, { status: 404 });
    }
    const auth = await authorizeSupportStaffWrite(supabase, user.id, existing.campaign_id, [
      existing.supporting_store_id,
      existing.requesting_store_id,
    ]);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const { error } = await supabase
      .from('campaign_support_staff')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting support staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
