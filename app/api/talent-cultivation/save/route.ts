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
    const { year_month, store_id, bonuses } = body as { 
      year_month: string; 
      store_id: string;
      bonuses: CultivationBonusInput[] 
    };

    if (!year_month || !store_id || !bonuses || bonuses.length === 0) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    // 驗證資料
    for (const bonus of bonuses) {
      if (!bonus.employee_code || !bonus.employee_name || !bonus.cultivation_target) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${bonus.employee_code || bonus.employee_name} 資料不完整（需包含育才對象）` 
        }, { status: 400 });
      }
    }

    let successCount = 0;
    const errors = [];

    // 逐筆更新員工的育才獎金
    for (const bonus of bonuses) {
      try {
        // 找到對應的 monthly_staff_status 記錄
        const { data: existing, error: findError } = await supabase
          .from('monthly_staff_status')
          .select('id')
          .eq('year_month', year_month)
          .eq('store_id', store_id)
          .eq('employee_code', bonus.employee_code.toUpperCase())
          .maybeSingle();

        if (findError) {
          errors.push(`員工 ${bonus.employee_code} 查詢失敗: ${findError.message}`);
          continue;
        }

        if (!existing) {
          errors.push(`員工 ${bonus.employee_code} 在該月份沒有狀態記錄`);
          continue;
        }

        // 更新育才獎金
        const { error: updateError } = await supabase
          .from('monthly_staff_status')
          .update({
            talent_cultivation_bonus: bonus.cultivation_bonus,
            talent_cultivation_target: bonus.cultivation_target,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (updateError) {
          errors.push(`員工 ${bonus.employee_code} 更新失敗: ${updateError.message}`);
        } else {
          successCount++;
        }
      } catch (error: any) {
        errors.push(`員工 ${bonus.employee_code} 處理失敗: ${error.message}`);
      }
    }

    if (successCount === 0) {
      return NextResponse.json({ 
        success: false, 
        error: `所有更新都失敗了。錯誤：${errors.join('; ')}` 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: successCount,
      message: `成功儲存 ${successCount} 筆育才獎金資料${errors.length > 0 ? `，${errors.length} 筆失敗` : ''}`,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
