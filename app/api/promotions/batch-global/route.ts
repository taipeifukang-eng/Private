import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { syncPromotionPositionToMonthlyStaffStatus } from '@/lib/monthly-staff/promotion-position-sync';
import { requirePermission } from '@/lib/permissions/check';

interface PromotionInput {
  employee_code: string;
  employee_name: string;
  position: string;
  effective_date: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 使用 RBAC 權限檢查
    const permission = await requirePermission(user.id, 'employee.promotion.batch');
    if (!permission.allowed) {
      return NextResponse.json(
        { success: false, error: permission.message },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { promotions } = body as { promotions: PromotionInput[] };

    if (!promotions || promotions.length === 0) {
      return NextResponse.json({ success: false, error: '缺少升遷資料' }, { status: 400 });
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

    // 為每筆記錄查詢舊職位和門市
    const promotionRecords = [];
    
    for (const promo of promotions) {
      // 查詢員工的舊職位和門市
      const { data: empData } = await supabase
        .from('store_employees')
        .select('position, current_position, store_id')
        .eq('employee_code', promo.employee_code.toUpperCase())
        .eq('is_active', true)
        .single();

      promotionRecords.push({
        employee_code: promo.employee_code.toUpperCase(),
        employee_name: promo.employee_name,
        store_id: empData?.store_id || null,
        movement_type: 'promotion',
        movement_date: promo.effective_date,
        new_value: promo.position,
        old_value: empData?.current_position || empData?.position || null,
        notes: promo.notes || null,
        created_by: user.id
      });
    }

    // 批次插入升遷記錄
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

    try {
      await syncPromotionPositionToMonthlyStaffStatus(
        adminSupabase,
        promotionRecords.map((record) => ({
          employee_code: record.employee_code,
          effective_date: record.movement_date,
          position: record.new_value,
        }))
      );
    } catch (syncError) {
      console.error('Promotion monthly status sync warning:', syncError);
      return NextResponse.json({
        success: false,
        error: syncError instanceof Error ? syncError.message : '同步升職月度職位失敗'
      }, { status: 500 });
    }

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
