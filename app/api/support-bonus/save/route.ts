import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, job_title')
      .eq('id', user.id)
      .single();

    // 只有店長以上權限可以使用
    const isManager = ['admin', 'manager', 'supervisor', 'area_manager'].includes(profile?.role || '');
    const isStoreManager = ['店長', '代理店長', '督導', '督導(代理店長)'].includes(profile?.job_title || '');
    
    if (!profile || (!isManager && !isStoreManager)) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { year_month, bonuses } = body as { year_month: string; bonuses: BonusInput[] };

    if (!year_month || !bonuses || bonuses.length === 0) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
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

    // 先刪除該月份的所有記錄
    const { error: deleteError } = await supabase
      .from('support_staff_bonus')
      .delete()
      .eq('year_month', year_month);

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
      employee_code: bonus.employee_code.toUpperCase(),
      employee_name: bonus.employee_name,
      bonus_amount: bonus.bonus_amount || 0,
      created_by: user.id
    }));

    const { data, error } = await supabase
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
