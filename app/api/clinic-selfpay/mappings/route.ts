import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getAuthorizedStores, getCurrentUserId } from '../_lib';

function isMissingSelfpayColumnError(message: string) {
  const msg = String(message || '').toLowerCase();
  return msg.includes('selfpay_drug_name') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const storeId = (request.nextUrl.searchParams.get('store_id') || '').trim();
    if (!storeId) {
      return NextResponse.json({ success: false, error: '缺少 store_id' }, { status: 400 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.some((s) => s.id === storeId)) {
      return NextResponse.json({ success: false, error: '無此門市查看權限' }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: priceRowsWithSelfpay, error: priceErrorWithSelfpay } = await admin
      .from('clinic_selfpay_price_entries')
      .select('health_insurance_code, product_code, product_name, selfpay_drug_name, year_month, updated_at')
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false })
      .limit(5000);

    let priceRows: any[] = priceRowsWithSelfpay || [];
    let useLegacyDrugNameFallback = false;

    if (priceErrorWithSelfpay && isMissingSelfpayColumnError(priceErrorWithSelfpay.message)) {
      const { data: legacyPriceRows, error: legacyPriceError } = await admin
        .from('clinic_selfpay_price_entries')
        .select('health_insurance_code, product_code, product_name, year_month, updated_at')
        .eq('store_id', storeId)
        .order('updated_at', { ascending: false })
        .limit(5000);

      if (legacyPriceError) {
        return NextResponse.json({ success: false, error: legacyPriceError.message }, { status: 500 });
      }
      priceRows = legacyPriceRows || [];
      useLegacyDrugNameFallback = true;
    } else if (priceErrorWithSelfpay) {
      return NextResponse.json({ success: false, error: priceErrorWithSelfpay.message }, { status: 500 });
    }

    let drugNameMap = new Map<string, string>();
    if (useLegacyDrugNameFallback) {
      const { data: batchRows } = await admin
        .from('clinic_selfpay_claim_batches')
        .select('id')
        .eq('store_id', storeId)
        .order('imported_at', { ascending: false })
        .limit(300);

      const batchIds = (batchRows || []).map((b: any) => b.id);
      if (batchIds.length > 0) {
        const { data: itemRows } = await admin
          .from('clinic_selfpay_claim_items')
          .select('health_insurance_code, drug_name, created_at')
          .in('batch_id', batchIds)
          .order('created_at', { ascending: false })
          .limit(10000);

        (itemRows || []).forEach((row: any) => {
          const code = String(row.health_insurance_code || '').toUpperCase();
          const name = String(row.drug_name || '').trim();
          if (!code || !name) return;
          if (!drugNameMap.has(code)) drugNameMap.set(code, name);
        });
      }
    }


    const latestMap = new Map<string, any>();
    (priceRows || []).forEach((row: any) => {
      const code = String(row.health_insurance_code || '').toUpperCase();
      if (!code || latestMap.has(code)) return;
      latestMap.set(code, row);
    });

    const data = Array.from(latestMap.entries())
      .map(([code, row]) => ({
        health_insurance_code: code,
        drug_name: row.selfpay_drug_name || drugNameMap.get(code) || row.product_name || '',
        product_code: row.product_code || '',
        product_name: row.product_name || '',
        latest_year_month: row.year_month || '',
      }))
      .sort((a, b) => a.health_insurance_code.localeCompare(b.health_insurance_code));

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
