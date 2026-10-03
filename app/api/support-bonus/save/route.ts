import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

interface BonusInput {
  employee_code: string;
  employee_name: string;
  bonus_amount: number;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const canEditSupportBonus = await hasPermission(user.id, 'monthly.allowance.edit_support_bonus');
    if (!canEditSupportBonus) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { year_month, store_id, bonuses } = body as { 
      year_month: string; 
      store_id: string;
      bonuses: BonusInput[] 
    };

    if (!year_month || !store_id || !Array.isArray(bonuses)) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    const adminSupabase = createAdminClient();
    const canViewAllStores = await hasPermission(user.id, 'monthly.status.view_all');

    if (!canViewAllStores) {
      const { data: assignment, error: assignmentError } = await adminSupabase
        .from('store_managers')
        .select('id')
        .eq('user_id', user.id)
        .eq('store_id', store_id)
        .limit(1)
        .maybeSingle();

      if (assignmentError) {
        return NextResponse.json({ success: false, error: assignmentError.message }, { status: 500 });
      }

      if (!assignment) {
        return NextResponse.json({ success: false, error: '您未被指派管理此門市' }, { status: 403 });
      }
    }

    const { data: storeSummary, error: summaryError } = await adminSupabase
      .from('monthly_store_summary')
      .select('store_status')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .maybeSingle();

    if (summaryError) {
      return NextResponse.json({ success: false, error: summaryError.message }, { status: 500 });
    }

    if (storeSummary?.store_status === 'confirmed') {
      return NextResponse.json({ success: false, error: '此月份已確認，無法修改單品獎金' }, { status: 409 });
    }

    // 驗證資料
    for (const bonus of bonuses) {
      if (!bonus.employee_code || !bonus.employee_name) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${bonus.employee_code || bonus.employee_name} 資料不完整` 
        }, { status: 400 });
      }
    }

    // 如果沒有新記錄（全部清除），嘗試刪舊資料後回傳成功
    if (bonuses.length === 0) {
      await adminSupabase
        .from('support_staff_bonus')
        .delete()
        .eq('year_month', year_month)
        .eq('store_id', store_id);
      return NextResponse.json({ success: true, count: 0, message: '已清除所有支援人員獎金記錄' });
    }

    // 先刪除該月份該門市的所有記錄
    const { error: deleteError } = await adminSupabase
      .from('support_staff_bonus')
      .delete()
      .eq('year_month', year_month)
      .eq('store_id', store_id);

    if (deleteError) {
      console.error('Error deleting old records:', deleteError);
      return NextResponse.json({ 
        success: false, 
        error: `刪除舊資料失敗: ${deleteError.message}` 
      }, { status: 500 });
    }

    // 批次插入新資料
    const records = bonuses.map(bonus => ({
      year_month,
      store_id,
      employee_code: bonus.employee_code.toUpperCase(),
      employee_name: bonus.employee_name,
      bonus_amount: bonus.bonus_amount || 0,
      created_by: user.id
    }));

    const { data, error } = await adminSupabase
      .from('support_staff_bonus')
      .insert(records)
      .select();

    if (error) {
      console.error('Error saving support bonus:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: data.length,
      message: `成功儲存 ${data.length} 筆支援人員獎金資料`
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
