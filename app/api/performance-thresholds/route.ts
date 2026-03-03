import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MONTHLY_THRESHOLDS, QUARTERLY_THRESHOLDS } from '@/lib/performance/bonus-calc';

/**
 * GET /api/performance-thresholds?store_id=xxx
 * 取得門市自訂獎金門檻設定，若未設定則回傳系統預設值
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const storeId = request.nextUrl.searchParams.get('store_id');
    if (!storeId) return NextResponse.json({ error: '缺少 store_id' }, { status: 400 });

    const { data } = await supabase
      .from('store_performance_thresholds')
      .select('period_type, threshold_level, multiplier, base_amount')
      .eq('store_id', storeId)
      .order('period_type')
      .order('threshold_level');

    // 轉為 { monthly: [...], quarterly: [...] }
    const rows = data || [];

    const buildSet = (type: 'monthly' | 'quarterly', defaults: typeof MONTHLY_THRESHOLDS) =>
      defaults.map((def, i) => {
        const saved = rows.find(r => r.period_type === type && r.threshold_level === i + 1);
        return {
          level: i + 1,
          multiplier: def.multiplier,
          baseAmount: saved ? Number(saved.base_amount) : def.baseAmount,
          label: def.label,
          isCustom: !!saved,
        };
      });

    return NextResponse.json({
      monthly: buildSet('monthly', MONTHLY_THRESHOLDS),
      quarterly: buildSet('quarterly', QUARTERLY_THRESHOLDS),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * POST /api/performance-thresholds
 * 儲存門市自訂獎金門檻設定
 *
 * Body: {
 *   store_id: string,
 *   monthly: Array<{ level: number; base_amount: number }>,
 *   quarterly: Array<{ level: number; base_amount: number }>,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { store_id, monthly, quarterly } = body as {
      store_id: string;
      monthly: { level: number; base_amount: number }[];
      quarterly: { level: number; base_amount: number }[];
    };

    if (!store_id || !monthly || !quarterly) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 組合所有要 upsert 的列
    const upsertRows = [
      ...monthly.map((t, i) => ({
        store_id,
        period_type: 'monthly',
        threshold_level: t.level,
        multiplier: MONTHLY_THRESHOLDS[i]?.multiplier ?? (1.0 + i * 0.1),
        base_amount: t.base_amount,
        updated_at: new Date().toISOString(),
      })),
      ...quarterly.map((t, i) => ({
        store_id,
        period_type: 'quarterly',
        threshold_level: t.level,
        multiplier: QUARTERLY_THRESHOLDS[i]?.multiplier ?? (1.0 + i * 0.1),
        base_amount: t.base_amount,
        updated_at: new Date().toISOString(),
      })),
    ];

    const { error } = await supabase
      .from('store_performance_thresholds')
      .upsert(upsertRows, { onConflict: 'store_id,period_type,threshold_level' });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
