import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET: 查詢指定門市和年月的誤餐費記錄
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const yearMonth = searchParams.get('year_month');
    const storeId = searchParams.get('store_id');

    if (!yearMonth || !storeId) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少必要參數' 
      }, { status: 400 });
    }

    // 查詢誤餐費記錄
    const { data: records, error } = await supabase
      .from('meal_allowance_records')
      .select('*')
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .order('record_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching meal allowance records:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      records: records || [] 
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

/**
 * POST: 新增誤餐費記錄
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const body = await request.json();
    const {
      year_month,
      store_id,
      record_date,
      employee_code,
      employee_name,
      work_hours,
      meal_period,
      employee_type
    } = body;

    // 驗證必填欄位
    if (!year_month || !store_id || !record_date || !employee_name || !work_hours || !meal_period || !employee_type) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少必要欄位' 
      }, { status: 400 });
    }

    // 新增記錄
    const { data, error } = await supabase
      .from('meal_allowance_records')
      .insert({
        year_month,
        store_id,
        record_date,
        employee_code: employee_code || null,
        employee_name,
        work_hours,
        meal_period,
        employee_type
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating meal allowance record:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      record: data 
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

/**
 * DELETE: 刪除誤餐費記錄
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const recordId = searchParams.get('id');

    if (!recordId) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少記錄ID' 
      }, { status: 400 });
    }

    // 刪除記錄
    const { error } = await supabase
      .from('meal_allowance_records')
      .delete()
      .eq('id', recordId);

    if (error) {
      console.error('Error deleting meal allowance record:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
