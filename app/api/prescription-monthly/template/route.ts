import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { getPrescriptionReportContext } from '@/lib/performance/prescription-report-context';
import { buildPrescriptionTemplateWorkbook, writePrescriptionTemplate } from '@/lib/performance/prescription-template';

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
    // 門市順序沿用 context.stores（與 Google Sheet 的門市順序一致）；已有的數值帶入一般／連續兩列
    const workbook = buildPrescriptionTemplateWorkbook(yearMonth, context.stores, byStore);
    const buffer = writePrescriptionTemplate(workbook);

    return new NextResponse(new Blob([buffer as BlobPart]), {
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
