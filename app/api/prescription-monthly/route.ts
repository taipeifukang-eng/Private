import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { getPrescriptionReportContext } from '@/lib/performance/prescription-report-context';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type PrescriptionInput = {
  store_id: string;
  regular_prescription_count: unknown;
  regular_prescription_point_value: unknown;
  chronic_prescription_count: unknown;
  chronic_prescription_point_value: unknown;
};

function parseCount(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return undefined;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 0 || number > 2147483647) return undefined;
  return number;
}

function parsePointValue(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(raw)) return undefined;
  const number = Number(raw);
  if (!Number.isFinite(number) || number > 99999999.9999) return undefined;
  return number;
}

export async function GET(request: NextRequest) {
  try {
    const context = await getPrescriptionReportContext();
    if ('response' in context) return context.response;

    const searchParams = new URL(request.url).searchParams;
    const year = searchParams.get('year') || '';
    const yearMonth = searchParams.get('year_month') || '';
    const storeIds = context.stores.map(store => store.id);

    if (year) {
      if (!/^\d{4}$/.test(year) || Number(year) < 2018 || Number(year) > 2100) {
        return NextResponse.json({ error: '年份格式不正確' }, { status: 400 });
      }

      let summaries: any[] = [];
      if (storeIds.length > 0) {
        const { data, error } = await context.admin
          .from('monthly_prescription_reports')
          .select(`
            store_id,
            year_month,
            regular_prescription_count,
            regular_prescription_point_value,
            chronic_prescription_count,
            chronic_prescription_point_value,
            total_chronic_prescription_count,
            prescription_data_updated_at,
            prescription_data_updated_by
          `)
          .gte('year_month', `${year}-01`)
          .lte('year_month', `${year}-12`)
          .in('store_id', storeIds);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        summaries = data || [];
      }

      const byStoreMonth = new Map(summaries.map(row => [`${row.store_id}:${row.year_month}`, row]));
      const records = context.stores.flatMap(store =>
        Array.from({ length: 12 }, (_, index) => {
          const month = `${year}-${String(index + 1).padStart(2, '0')}`;
          return {
            ...store,
            store_id: store.id,
            year_month: month,
            ...(byStoreMonth.get(`${store.id}:${month}`) || {
              regular_prescription_count: null,
              regular_prescription_point_value: null,
              chronic_prescription_count: null,
              chronic_prescription_point_value: null,
              total_chronic_prescription_count: null,
              prescription_data_updated_at: null,
              prescription_data_updated_by: null,
            }),
          };
        })
      );

      return NextResponse.json({ success: true, year, records });
    }

    if (!YEAR_MONTH_PATTERN.test(yearMonth)) {
      return NextResponse.json({ error: '月份格式需為 YYYY-MM' }, { status: 400 });
    }

    let summaries: any[] = [];
    if (storeIds.length > 0) {
      const { data, error } = await context.admin
        .from('monthly_prescription_reports')
        .select(`
          store_id,
          regular_prescription_count,
          regular_prescription_point_value,
          chronic_prescription_count,
          chronic_prescription_point_value,
          total_chronic_prescription_count,
          prescription_data_updated_at,
          prescription_data_updated_by
        `)
        .eq('year_month', yearMonth)
        .in('store_id', storeIds);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      summaries = data || [];
    }

    const byStore = new Map(summaries.map(row => [row.store_id, row]));
    const records = context.stores.map(store => ({
      ...store,
      store_id: store.id,
      ...(byStore.get(store.id) || {
        regular_prescription_count: null,
        regular_prescription_point_value: null,
        chronic_prescription_count: null,
        chronic_prescription_point_value: null,
        total_chronic_prescription_count: null,
        prescription_data_updated_at: null,
        prescription_data_updated_by: null,
      }),
    }));

    return NextResponse.json({ success: true, year_month: yearMonth, records });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '讀取處方箋資料失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getPrescriptionReportContext();
    if ('response' in context) return context.response;

    const canEdit = await hasPermission(context.user.id, 'performance.edit');
    if (!canEdit) return NextResponse.json({ error: '沒有編輯業績資料的權限' }, { status: 403 });

    const body = await request.json();
    const yearMonth = body?.year_month;
    const records = body?.records as PrescriptionInput[] | undefined;
    if (!YEAR_MONTH_PATTERN.test(yearMonth || '')) {
      return NextResponse.json({ error: '月份格式需為 YYYY-MM' }, { status: 400 });
    }
    if (!Array.isArray(records) || records.length === 0 || records.length > context.stores.length) {
      return NextResponse.json({ error: '沒有可儲存的資料' }, { status: 400 });
    }

    const storeById = new Map(context.stores.map(store => [store.id, store]));
    const seenStores = new Set<string>();
    const updatedAt = new Date().toISOString();
    const payload = [];

    for (const record of records) {
      const store = storeById.get(record?.store_id);
      if (!store || seenStores.has(record.store_id)) {
        return NextResponse.json({ error: '包含無權限或重複的門市資料' }, { status: 403 });
      }
      seenStores.add(record.store_id);

      const regularCount = parseCount(record.regular_prescription_count);
      const regularPointValue = parsePointValue(record.regular_prescription_point_value);
      const chronicCount = parseCount(record.chronic_prescription_count);
      const chronicPointValue = parsePointValue(record.chronic_prescription_point_value);
      if ([regularCount, regularPointValue, chronicCount, chronicPointValue].includes(undefined)) {
        return NextResponse.json({
          error: `${store.store_code} ${store.store_name} 的張數或點值格式不正確`,
        }, { status: 400 });
      }

      payload.push({
        year_month: yearMonth,
        store_id: store.id,
        regular_prescription_count: regularCount,
        regular_prescription_point_value: regularPointValue,
        chronic_prescription_count: chronicCount,
        chronic_prescription_point_value: chronicPointValue,
        prescription_data_updated_at: updatedAt,
        prescription_data_updated_by: context.user.id,
        updated_at: updatedAt,
      });
    }

    const { error } = await context.admin
      .from('monthly_prescription_reports')
      .upsert(payload, { onConflict: 'year_month,store_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, saved: payload.length, updated_at: updatedAt });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '儲存處方箋資料失敗' }, { status: 500 });
  }
}
