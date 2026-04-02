import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getAuthorizedStores, getClinicSelfpayAccess, getCurrentUserId } from '../../_lib';

function isMissingClosureTableError(message: string) {
  const msg = String(message || '').toLowerCase();
  return msg.includes('clinic_selfpay_price_month_closures') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const access = await getClinicSelfpayAccess(userId);
    if (!access.canManageMapping) {
      return NextResponse.json({ success: false, error: '無 DPOS 對應主檔管理權限' }, { status: 403 });
    }

    const body = await request.json();
    const storeId = String(body.store_id || '').trim();
    const yearMonth = String(body.year_month || '').trim();

    if (!storeId || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, error: '請提供正確的門市與年月' }, { status: 400 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.some((s) => s.id === storeId)) {
      return NextResponse.json({ success: false, error: '無此門市操作權限' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: existingRows, error: existingError } = await admin
      .from('clinic_selfpay_price_entries')
      .select('id')
      .eq('store_id', storeId)
      .eq('year_month', yearMonth)
      .limit(1);

    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }

    if (!existingRows || existingRows.length === 0) {
      return NextResponse.json({ success: false, error: '所選年月尚無主檔資料，無法關帳' }, { status: 400 });
    }

    const { data: closureRows, error: closureCheckError } = await admin
      .from('clinic_selfpay_price_month_closures')
      .select('id')
      .eq('store_id', storeId)
      .eq('year_month', yearMonth)
      .limit(1);

    if (closureCheckError) {
      if (isMissingClosureTableError(closureCheckError.message)) {
        return NextResponse.json(
          { success: false, error: '資料庫尚未建立主檔關帳表，請先執行 clinic selfpay migration' },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: false, error: closureCheckError.message }, { status: 500 });
    }

    const isClosed = Boolean(closureRows && closureRows.length > 0);

    if (isClosed) {
      const { error: reopenError } = await admin
        .from('clinic_selfpay_price_month_closures')
        .delete()
        .eq('store_id', storeId)
        .eq('year_month', yearMonth);

      if (reopenError) {
        return NextResponse.json({ success: false, error: reopenError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, yearMonth, isClosed: false, action: 'reopened' });
    }

    const { error } = await admin
      .from('clinic_selfpay_price_month_closures')
      .upsert(
        {
          store_id: storeId,
          year_month: yearMonth,
          closed_by: userId,
        },
        { onConflict: 'store_id,year_month' }
      );

    if (error) {
      if (isMissingClosureTableError(error.message)) {
        return NextResponse.json(
          { success: false, error: '資料庫尚未建立主檔關帳表，請先執行 clinic selfpay migration' },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, yearMonth, isClosed: true, action: 'closed' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}