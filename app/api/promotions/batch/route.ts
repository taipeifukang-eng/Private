import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { BatchPromotionInput } from '@/types/workflow';

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
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'manager', 'supervisor', 'area_manager'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { store_id, promotions } = body as { store_id: string; promotions: BatchPromotionInput[] };

    if (!store_id || !promotions || promotions.length === 0) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    // 驗證所有資料
    for (const promo of promotions) {
      if (!promo.employee_code || !promo.employee_name || !promo.position || !promo.effective_date) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${promo.employee_code || promo.employee_name} 資料不完整` 
        }, { status: 400 });
      }
    }

    // 批次插入升遷記錄
    const promotionRecords = promotions.map(promo => ({
      employee_code: promo.employee_code.toUpperCase(),
      employee_name: promo.employee_name,
      store_id,
      promotion_date: promo.effective_date,
      new_position: promo.position,
      old_position: null, // 會從現有資料查詢
      notes: promo.notes || null,
      created_by: user.id
    }));

    // 為每筆記錄查詢舊職位
    for (let i = 0; i < promotionRecords.length; i++) {
      const { data: empData } = await supabase
        .from('store_employees')
        .select('position, current_position')
        .eq('employee_code', promotionRecords[i].employee_code)
        .eq('store_id', store_id)
        .single();

      if (empData) {
        promotionRecords[i].old_position = empData.current_position || empData.position || null;
      }
    }

    const { data, error } = await supabase
      .from('employee_movement_history')
      .insert(promotionRecords)
      .select();

    if (error) {
      console.error('Error creating promotion records:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 });
    }

    // 觸發器會自動更新 monthly_staff_status 和 store_employees

    return NextResponse.json({
      success: true,
      created: data.length,
      message: `成功建立 ${data.length} 筆升遷記錄，已自動更新對應月份的職位資料`
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
