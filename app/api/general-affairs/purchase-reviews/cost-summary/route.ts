import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canReadPurchaseReviews } from '@/lib/general-affairs/purchase-reviews/access';

export const dynamic = 'force-dynamic';

type PurchaseReviewSummaryRow = {
  id: string;
  decision: string;
  estimated_amount: number | string | null;
  quoted_amount: number | string | null;
  negotiated_amount: number | string | null;
  final_amount: number | string | null;
  vendor_name: string | null;
  created_at: string;
  vendor?: { id?: string | null; name?: string | null; alias?: string | null } | null;
  request?: {
    id?: string | null;
    request_no?: string | null;
    title?: string | null;
    store?: { id?: string | null; store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  } | null;
};

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '採購成本摘要載入失敗');
  const resolvedStatus = message.includes('schema cache') || message.includes('Could not find') ? 503 : status;
  return NextResponse.json({
    success: false,
    error: resolvedStatus === 503 ? '採購評估資料表尚未建置到目前環境，請先套用 general_affairs_purchase_reviews migration' : message,
  }, { status: resolvedStatus });
}

function monthRange(yearMonth: string | null) {
  const now = new Date();
  const normalized = /^\d{4}-\d{2}$/.test(yearMonth || '')
    ? yearMonth!
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, month] = normalized.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { yearMonth: normalized, start: start.toISOString(), end: end.toISOString() };
}

function amountOf(row: PurchaseReviewSummaryRow) {
  return Number(row.final_amount || row.negotiated_amount || row.quoted_amount || row.estimated_amount || 0) || 0;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function addRank(
  map: Map<string, { key: string; label: string; amount: number; count: number }>,
  key: string,
  label: string,
  amount: number,
) {
  const current = map.get(key) || { key, label, amount: 0, count: 0 };
  current.amount += amount;
  current.count += 1;
  map.set(key, current);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canReadPurchaseReviews()) return jsonError('沒有採購成本查看權限', 403);

    const { searchParams } = new URL(request.url);
    const range = monthRange(searchParams.get('yearMonth'));

    const { data, error } = await supabase
      .from('ga_purchase_reviews')
      .select(`
        id,
        decision,
        estimated_amount,
        quoted_amount,
        negotiated_amount,
        final_amount,
        vendor_name,
        created_at,
        vendor:ga_vendors(id, name, alias),
        request:ga_service_requests(id, request_no, title, store:stores(id, store_code, store_name, short_name))
      `)
      .eq('decision', 'PURCHASE')
      .is('deleted_at', null)
      .gte('created_at', range.start)
      .lt('created_at', range.end)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const storeMap = new Map<string, { key: string; label: string; amount: number; count: number }>();
    const vendorMap = new Map<string, { key: string; label: string; amount: number; count: number }>();
    let totalAmount = 0;
    let amountFilledCount = 0;

    ((data || []) as unknown[]).forEach((raw) => {
      const row = raw as PurchaseReviewSummaryRow & {
        vendor?: PurchaseReviewSummaryRow['vendor'] | PurchaseReviewSummaryRow['vendor'][];
        request?: PurchaseReviewSummaryRow['request'] | PurchaseReviewSummaryRow['request'][];
      };
      const vendor = firstRelation(row.vendor);
      const requestRow = firstRelation(row.request);
      const amount = amountOf(row);
      totalAmount += amount;
      if (amount > 0) amountFilledCount += 1;

      const store = requestRow?.store;
      const storeKey = store?.id || 'unknown-store';
      const storeLabel = [store?.store_code, store?.short_name || store?.store_name].filter(Boolean).join(' ') || '未對應門市';
      addRank(storeMap, storeKey, storeLabel, amount);

      const vendorKey = vendor?.id || row.vendor_name || 'unknown-vendor';
      const vendorLabel = vendor?.name || row.vendor_name || '未指定供應商';
      addRank(vendorMap, vendorKey, vendorLabel, amount);
    });

    const toTop = (map: Map<string, { key: string; label: string; amount: number; count: number }>) => (
      Array.from(map.values())
        .sort((a, b) => b.amount - a.amount || b.count - a.count)
        .slice(0, 5)
    );

    return NextResponse.json({
      success: true,
      data: {
        yearMonth: range.yearMonth,
        totalAmount,
        purchaseCount: data?.length || 0,
        amountFilledCount,
        missingAmountCount: Math.max(0, (data?.length || 0) - amountFilledCount),
        topStores: toTop(storeMap),
        topVendors: toTop(vendorMap),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
