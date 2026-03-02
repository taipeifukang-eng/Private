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
    const errors: string[] = [];
    const debugLog: any[] = [];

    console.log(`[TalentCultivation] 開始儲存 year_month=${year_month} store_id=${store_id} 共 ${bonuses.length} 筆`);

    // 逐筆更新員工的育才獎金
    for (const bonus of bonuses) {
      try {
        const empCode = bonus.employee_code.toUpperCase();
        console.log(`[TalentCultivation] 處理員工 ${empCode} bonus=${bonus.cultivation_bonus} target=${bonus.cultivation_target}`);

        // 先找本店記錄
        const { data: existing, error: findError } = await supabase
          .from('monthly_staff_status')
          .select('id')
          .eq('year_month', year_month)
          .eq('store_id', store_id)
          .eq('employee_code', empCode)
          .maybeSingle();

        console.log(`[TalentCultivation] 查詢結果 ${empCode}:`, { existing, findError });

        if (findError) {
          const msg = `員工 ${empCode} 查詢失敗: ${findError.message} (code: ${findError.code})`;
          errors.push(msg);
          debugLog.push({ empCode, action: 'find', status: 'error', detail: findError });
          console.error(`[TalentCultivation] ${msg}`);
          continue;
        }

        if (existing) {
          // 有記錄：直接更新
          console.log(`[TalentCultivation] 更新現有記錄 ${empCode} id=${existing.id}`);
          const { error: updateError } = await supabase
            .from('monthly_staff_status')
            .update({
              talent_cultivation_bonus: bonus.cultivation_bonus,
              talent_cultivation_target: bonus.cultivation_target,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);

          if (updateError) {
            const msg = `員工 ${empCode} 更新失敗: ${updateError.message} (code: ${updateError.code})`;
            errors.push(msg);
            debugLog.push({ empCode, action: 'update', status: 'error', detail: updateError });
            console.error(`[TalentCultivation] ${msg}`);
          } else {
            successCount++;
            debugLog.push({ empCode, action: 'update', status: 'success' });
            console.log(`[TalentCultivation] 更新成功 ${empCode}`);
          }
        } else {
          // 無記錄（跨分店員工）：在本店建立一筆新記錄
          console.log(`[TalentCultivation] 新增記錄 ${empCode} 至 store_id=${store_id}`);
          const insertPayload = {
            year_month,
            store_id,
            employee_code: empCode,
            employee_name: bonus.employee_name,
            talent_cultivation_bonus: bonus.cultivation_bonus,
            talent_cultivation_target: bonus.cultivation_target,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          console.log(`[TalentCultivation] 新增 payload:`, insertPayload);

          const { error: insertError } = await supabase
            .from('monthly_staff_status')
            .insert(insertPayload);

          if (insertError) {
            const msg = `員工 ${empCode} 新增失敗: ${insertError.message} (code: ${insertError.code})`;
            errors.push(msg);
            debugLog.push({ empCode, action: 'insert', status: 'error', detail: insertError });
            console.error(`[TalentCultivation] ${msg}`);
          } else {
            successCount++;
            debugLog.push({ empCode, action: 'insert', status: 'success' });
            console.log(`[TalentCultivation] 新增成功 ${empCode}`);
          }
        }
      } catch (error: any) {
        const msg = `員工 ${bonus.employee_code} 處理失敗: ${error.message}`;
        errors.push(msg);
        debugLog.push({ empCode: bonus.employee_code, action: 'unknown', status: 'exception', detail: error.message });
        console.error(`[TalentCultivation] ${msg}`);
      }
    }

    console.log(`[TalentCultivation] 完成：成功 ${successCount} 筆，失敗 ${errors.length} 筆`, errors);

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
      errors: errors.length > 0 ? errors : undefined,
      debug: debugLog
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
