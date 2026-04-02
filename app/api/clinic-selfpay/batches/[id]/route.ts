import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getAuthorizedStores, getClinicSelfpayAccess, getCurrentUserId } from '../../_lib';

function roundTo1(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function parseScreenshotPaths(raw: unknown): string[] {
  const value = String(raw || '').trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v || '').trim()).filter(Boolean);
    }
  } catch {
    // legacy single-path format
  }
  return [value];
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const access = await getClinicSelfpayAccess(userId);
    if (!access.canUseCalculator) {
      return NextResponse.json({ success: false, error: '無毛利計算查閱權限' }, { status: 403 });
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

    const screenshotPaths = parseScreenshotPaths(batch.screenshot_path);
    const screenshotUrls: string[] = [];
    for (const path of screenshotPaths) {
      const { data } = await admin.storage
        .from('clinic-selfpay-screenshots')
        .createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) screenshotUrls.push(data.signedUrl);
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

    summary.totalBilling = roundTo1(summary.totalBilling);
    summary.totalGrossProfit = roundTo1(summary.totalGrossProfit);

    return NextResponse.json({ success: true, batch, items: items || [], summary, screenshotUrls });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const access = await getClinicSelfpayAccess(userId);
    if (!access.canDeleteBatch) {
      return NextResponse.json({ success: false, error: '無刪除匯入資料權限' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: batch, error: batchError } = await admin
      .from('clinic_selfpay_claim_batches')
      .select('id, store_id, screenshot_path')
      .eq('id', params.id)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ success: false, error: '找不到批次' }, { status: 404 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.some((s) => s.id === batch.store_id)) {
      return NextResponse.json({ success: false, error: '無此批次刪除權限' }, { status: 403 });
    }

    const screenshotPaths = parseScreenshotPaths(batch.screenshot_path);
    if (screenshotPaths.length > 0) {
      await admin.storage.from('clinic-selfpay-screenshots').remove(screenshotPaths);
    }

    const { error: deleteError } = await admin
      .from('clinic_selfpay_claim_batches')
      .delete()
      .eq('id', params.id);

    if (deleteError) {
      return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
