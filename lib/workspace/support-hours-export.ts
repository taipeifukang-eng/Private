import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { buildHistoricalStoreCodeMap } from '@/lib/store/historical';

/**
 * 門市支援時數 Excel（舊 /api/export-monthly-status/support-hours 的產檔部分，原樣搬出共用）。
 * 權限檢查由呼叫端負責：舊 route 用角色／職稱；workspace 包裝層只看 monthly.export.download。
 */
export async function buildSupportHoursResponse(supabase: any, yearMonth: string): Promise<NextResponse> {
  // 獲取所有門市及其支援時數
  const { data: stores, error: storesError } = await supabase
    .from('stores')
    .select(`
      id,
      store_code,
      store_name
    `)
    .eq('is_active', true)
    .order('store_code');

  if (storesError) {
    console.error('Error fetching stores:', storesError);
    return NextResponse.json(
      { success: false, error: '獲取門市失敗' },
      { status: 500 }
    );
  }

  // 建立歷史門市代碼映射
  const storeIds = (stores || []).map((s: { id: string }) => s.id);
  const codeMap = await buildHistoricalStoreCodeMap(supabase, storeIds, yearMonth);

  // 獲取每個門市的支援時數資料
  const supportHoursData = await Promise.all(
    (stores || []).map(async (store: { id: string; store_code: string; store_name: string }) => {
      const { data: summary } = await supabase
        .from('monthly_store_summary')
        .select('support_to_other_stores_hours, support_from_other_stores_hours')
        .eq('store_id', store.id)
        .eq('year_month', yearMonth)
        .maybeSingle();

      return {
        門市代號: codeMap[store.id] || store.store_code,
        門市名稱: store.store_name,
        分店支援時數: summary?.support_from_other_stores_hours || 0,
        支援分店時數: summary?.support_to_other_stores_hours || 0
      };
    })
  );

  // 建立工作簿
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(supportHoursData);

  // 設定欄位寬度
  ws['!cols'] = [
    { wch: 12 }, // 門市代號
    { wch: 20 }, // 門市名稱
    { wch: 15 }, // 分店支援時數
    { wch: 15 }  // 支援分店時數
  ];

  XLSX.utils.book_append_sheet(wb, ws, '門市支援時數');

  // 生成 buffer
  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  // 設定檔案名稱
  const fileName = `門市支援時數_${yearMonth}.xlsx`;

  // 返回 Excel 檔案
  return new NextResponse(excelBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}
