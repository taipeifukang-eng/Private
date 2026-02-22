import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface BonusInput {
  employee_code: string;
  employee_name: string;
  attendance_date: string;
  category: string;
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
    const { year_month, store_id, records } = body as { 
      year_month: string; 
      store_id: string;
      records: BonusInput[];
    };

    if (!year_month || !store_id || !records) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    // 先刪除該月份該門市的所有春節獎金記錄（全部替換模式）
    const { error: deleteError } = await supabase
      .from('spring_festival_bonus')
      .delete()
      .eq('year_month', year_month)
      .eq('store_id', store_id);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return NextResponse.json({ success: false, error: '清除舊資料失敗: ' + deleteError.message }, { status: 500 });
    }

    // 如果沒有新紀錄（全部清除），直接回傳成功
    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: '已清除所有春節出勤獎金記錄'
      });
    }

    // 驗證資料
    for (const record of records) {
      if (!record.employee_code || !record.employee_name || !record.attendance_date || !record.category) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${record.employee_code || record.employee_name} 資料不完整` 
        }, { status: 400 });
      }
      if (!['藥師', '主管', '專員'].includes(record.category)) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${record.employee_code} 的對象分類不正確` 
        }, { status: 400 });
      }
    }

    // 批次插入新記錄
    const insertData = records.map(r => ({
      year_month,
      store_id,
      employee_code: r.employee_code,
      employee_name: r.employee_name,
      attendance_date: r.attendance_date,
      category: r.category,
      bonus_amount: r.bonus_amount,
      created_by: user.id
    }));

    const { error: insertError } = await supabase
      .from('spring_festival_bonus')
      .insert(insertData);

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ success: false, error: '儲存失敗: ' + insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: records.length,
      message: `成功儲存 ${records.length} 筆春節出勤獎金`
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
