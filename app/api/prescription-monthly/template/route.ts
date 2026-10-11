import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { hasPermission } from '@/lib/permissions/check';
import { getPrescriptionReportContext } from '@/lib/performance/prescription-report-context';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: NextRequest) {
  try {
    const context = await getPrescriptionReportContext();
    if ('response' in context) return context.response;

    const canEdit = await hasPermission(context.user.id, 'performance.edit');
    if (!canEdit) return NextResponse.json({ error: '沒有下載處方箋匯入範本的權限' }, { status: 403 });

    const yearMonth = new URL(request.url).searchParams.get('year_month') || '';
    if (!YEAR_MONTH_PATTERN.test(yearMonth)) {
      return NextResponse.json({ error: '年月格式需為 YYYY-MM' }, { status: 400 });
    }

    const storeIds = context.stores.map(store => store.id);
    const { data: existing, error } = storeIds.length > 0
      ? await context.admin
        .from('monthly_prescription_reports')
        .select('store_id, regular_prescription_count, regular_prescription_point_value, chronic_prescription_count, chronic_prescription_point_value')
        .eq('year_month', yearMonth)
        .in('store_id', storeIds)
      : { data: [], error: null };

    if (error) return NextResponse.json({ error: '讀取處方箋資料失敗：' + error.message }, { status: 500 });
    const byStore = new Map((existing || []).map(row => [row.store_id, row]));
    const rows = [
      ['年月', '門市代號', '門市名稱', '一般箋張數', '一般箋點值', '慢箋張數', '慢箋點值'],
      ...context.stores.map(store => {
        const report = byStore.get(store.id);
        return [
          yearMonth,
          store.store_code,
          store.store_name,
          report?.regular_prescription_count ?? '',
          report?.regular_prescription_point_value ?? '',
          report?.chronic_prescription_count ?? '',
          report?.chronic_prescription_point_value ?? '',
        ];
      }),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 12 }, { wch: 14 }, { wch: 20 },
      { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '處方箋月報');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`處方箋匯入範本_${yearMonth}.xlsx`)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[Prescription report] template error:', error);
    return NextResponse.json({ error: error.message || '下載範本失敗' }, { status: 500 });
  }
}
