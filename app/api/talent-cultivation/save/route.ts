import { authorizeMonthlyRegistration, MonthlyRegistrationError } from '@/lib/permissions/monthly-registration';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface CultivationBonusInput {
  employee_code: string;
  employee_name: string;
  cultivation_bonus: number;
  cultivation_target: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const body = await request.json();
    const { year_month, store_id, bonuses } = body as { 
      year_month: string; 
      store_id: string;
      bonuses: CultivationBonusInput[] 
    };

    if (!year_month || !store_id || !bonuses) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    const registrationDb = await authorizeMonthlyRegistration(user.id, store_id, year_month);

    // 驗證資料
    for (const bonus of bonuses) {
      if (!bonus.employee_code || !bonus.employee_name || !bonus.cultivation_target) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${bonus.employee_code || bonus.employee_name} 資料不完整（需包含育才對象）` 
        }, { status: 400 });
      }
    }

    // 如果沒有新記錄（全部清除），嘗試刪舊資料後回傳成功
    if (bonuses.length === 0) {
      await registrationDb
        .from('talent_cultivation_bonus')
        .delete()
        .eq('year_month', year_month)
        .eq('store_id', store_id);
      return NextResponse.json({ success: true, count: 0, message: '已清除所有育才獎金記錄' });
    }

    // 先刪除該門市該月所有舊記錄（整批替換）
    const { error: deleteError } = await registrationDb
      .from('talent_cultivation_bonus')
      .delete()
      .eq('year_month', year_month)
      .eq('store_id', store_id);

    if (deleteError) {
      console.error('[TalentCultivation] 刪除舊資料失敗:', deleteError);
      return NextResponse.json({ success: false, error: `刪除舊資料失敗: ${deleteError.message}` }, { status: 500 });
    }

    // 批次插入新記錄
    const insertRecords = bonuses.map(b => ({
      year_month,
      store_id,
      employee_code: b.employee_code.toUpperCase(),
      employee_name: b.employee_name,
      cultivation_bonus: b.cultivation_bonus,
      cultivation_target: b.cultivation_target,
      created_by: user.id
    }));

    const { data: insertedData, error: insertError } = await registrationDb
      .from('talent_cultivation_bonus')
      .insert(insertRecords)
      .select();

    if (insertError) {
      console.error('[TalentCultivation] 插入失敗:', insertError);
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: insertedData?.length || 0,
      message: `成功儲存 ${insertedData?.length || 0} 筆育才獎金`
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: error instanceof MonthlyRegistrationError ? error.status : 500 }
    );
  }
}
