import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getAuthorizedStores, getCurrentUserId } from '../../_lib';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: batch, error: batchError } = await admin
      .from('clinic_selfpay_claim_batches')
      .select('*')
      .eq('id', params.id)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ success: false, error: '找不到批次' }, { status: 404 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.some((s) => s.id === batch.store_id)) {
      return NextResponse.json({ success: false, error: '無此批次查看權限' }, { status: 403 });
    }

    const { data: items, error: itemError } = await admin
      .from('clinic_selfpay_claim_items')
      .select('*')
      .eq('batch_id', params.id)
      .order('line_no', { ascending: true });

    if (itemError) {
      return NextResponse.json({ success: false, error: itemError.message }, { status: 500 });
    }

    const summary = (items || []).reduce(
      (acc, row: any) => {
        acc.itemCount += 1;
        acc.totalQty += Number(row.qty || 0);
        acc.totalBilling += Number(row.billing_amount || 0);
        acc.totalGrossProfit += Number(row.gross_profit_amount || 0);
        if (row.match_status === 'matched') acc.matchedCount += 1;
        else acc.unmatchedCount += 1;
        return acc;
      },
      {
        itemCount: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        totalQty: 0,
        totalBilling: 0,
        totalGrossProfit: 0,
      }
    );

    return NextResponse.json({ success: true, batch, items: items || [], summary });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
