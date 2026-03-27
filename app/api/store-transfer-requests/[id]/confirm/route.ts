import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

// POST - 督導確認調店申請，填入生效日期並寫入異動歷程
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = profile?.role === 'admin';
    const canConfirm = await hasPermission(user.id, 'employee.store_transfer.confirm');

    if (!isAdmin && !canConfirm) {
      return NextResponse.json({ success: false, error: '只有督導可以確認調店申請' }, { status: 403 });
    }

    const { effective_date } = await request.json();
    if (!effective_date) {
      return NextResponse.json({ success: false, error: '請填入生效日期' }, { status: 400 });
    }

    // 取得申請記錄
    const { data: req, error: fetchError } = await supabase
      .from('store_transfer_requests')
      .select('*')
      .eq('id', params.id)
      .single();

    if (fetchError || !req) {
      return NextResponse.json({ success: false, error: '找不到此申請記錄' }, { status: 404 });
    }

    if (req.status !== 'pending') {
      return NextResponse.json({ success: false, error: '此申請已被處理，無法重複確認' }, { status: 400 });
    }

    // 非 admin 的督導必須管轄原任職門市或新任職門市其中一個才能確認
    if (!isAdmin) {
      const { data: managedList } = await supabase
        .from('store_managers')
        .select('store_id')
        .eq('user_id', user.id)
        .in('store_id', [req.from_store_id, req.to_store_id]);

      if (!managedList || managedList.length === 0) {
        return NextResponse.json({ success: false, error: '您不是此調店相關門市的督導，無法確認此調店申請' }, { status: 403 });
      }
    }

    // 查詢門市名稱
    const [{ data: fromStore }, { data: toStore }] = await Promise.all([
      supabase.from('stores').select('store_name').eq('id', req.from_store_id).single(),
      supabase.from('stores').select('store_name').eq('id', req.to_store_id).single(),
    ]);

    // 查詢員工目前資料（取得 store_id）
    const { data: empData } = await supabase
      .from('store_employees')
      .select('store_id, position, current_position, employment_status')
      .eq('employee_code', req.employee_code)
      .eq('is_active', true)
      .maybeSingle();

    // 檢查是否有重複異動記錄
    const { data: existingRecord } = await supabase
      .from('employee_movement_history')
      .select('id')
      .eq('employee_code', req.employee_code)
      .eq('movement_date', effective_date)
      .eq('movement_type', 'store_transfer')
      .maybeSingle();

    if (existingRecord) {
      return NextResponse.json({
        success: false,
        error: `此員工（${req.employee_code}）在 ${effective_date} 已存在調店記錄，請確認日期`
      }, { status: 400 });
    }

    // 寫入 employee_movement_history
    const { data: movementRecord, error: movementError } = await supabase
      .from('employee_movement_history')
      .insert({
        employee_code: req.employee_code,
        employee_name: req.employee_name,
        store_id: req.to_store_id,
        movement_type: 'store_transfer',
        movement_date: effective_date,
        old_value: fromStore?.store_name || req.from_store_id,
        new_value: toStore?.store_name || req.to_store_id,
        notes: req.notes || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (movementError) {
      console.error('Error creating movement history:', movementError);
      return NextResponse.json({ success: false, error: movementError.message }, { status: 500 });
    }

    // 更新申請狀態
    const { error: updateError } = await supabase
      .from('store_transfer_requests')
      .update({
        status: 'confirmed',
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
        effective_date,
        movement_history_id: movementRecord.id,
      })
      .eq('id', params.id);

    if (updateError) {
      console.error('Error updating transfer request:', updateError);
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: `✅ 調店確認完成，已寫入異動歷程（生效日期：${effective_date}）` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
