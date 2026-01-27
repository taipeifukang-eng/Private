import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

interface PerformanceRow {
  '門市別': string;
  '收銀代號': string;
  '收銀員姓名': string;
  '交易次數': number;
  '平均購件數': number;
  '銷售金額': number;
  '毛利': number;
  '毛利佔比': number;
  '毛利率': number;
  '金額佔比': number;
  '客毛利': number;
  '客單價': number;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'supervisor', 'area_manager'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const yearMonth = formData.get('year_month') as string;

    if (!file || !yearMonth) {
      return NextResponse.json({ success: false, error: '缺少檔案或年月參數' }, { status: 400 });
    }

    // 讀取 Excel 檔案
    const buffer = await file.arrayBuffer();
    const workbook: XLSX.WorkBook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    // 從第 2 列開始讀取（第 1 列是 GridBand1，第 2 列才是欄位名稱）
    // range: 1 表示從第 2 列（索引 1）開始讀取
    let data: PerformanceRow[] = XLSX.utils.sheet_to_json(worksheet, { range: 1 });

    console.log('原始讀取資料筆數:', data.length);
    if (data.length > 0) {
      console.log('第一筆資料:', data[0]);
      console.log('Excel 欄位名稱:', Object.keys(data[0]));
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ success: false, error: 'Excel 檔案沒有資料' }, { status: 400 });
    }

    // 過濾掉最後一列的合計
    const originalLength = data.length;
    data = data.filter((row) => {
      const storeName = row['門市別']?.toString().trim();
      
      // 跳過任何包含 合計 的列
      if (storeName === '合計' || storeName === '' || !storeName) {
        return false;
      }
      
      return true;
    });

    console.log(`過濾前: ${originalLength} 筆, 過濾後: ${data.length} 筆`);
    if (data.length === 0) {
      return NextResponse.json({ success: false, error: 'Excel 檔案沒有有效資料（可能都是合計列或空列）' }, { status: 400 });
    }

    // 按員工代號分組並合併跨門市資料
    const employeeMap = new Map<string, {
      employeeCode: string;
      employeeName: string;
      totalTransactionCount: number;
      totalSalesAmount: number;
      totalGrossProfit: number;
      storeDetails: Array<{
        storeCode: string;
        storeName: string;
        transactionCount: number;
        salesAmount: number;
        grossProfit: number;
        grossProfitRate: number;
      }>;
    }>();

    for (const row of data) {
      const employeeCode = row['收銀代號']?.toString().trim();
      const employeeName = row['收銀員姓名']?.toString().trim();
      const storeCode = row['門市別']?.toString().trim();
      
      if (!employeeCode) continue;

      const transactionCount = Number(row['交易次數']) || 0;
      const salesAmount = Number(row['銷售金額']) || 0;
      const grossProfit = Number(row['毛利']) || 0;
      const grossProfitRate = Number(row['毛利率']) || 0;

      if (!employeeMap.has(employeeCode)) {
        employeeMap.set(employeeCode, {
          employeeCode,
          employeeName,
          totalTransactionCount: 0,
          totalSalesAmount: 0,
          totalGrossProfit: 0,
          storeDetails: []
        });
      }

      const empData = employeeMap.get(employeeCode)!;
      empData.totalTransactionCount += transactionCount;
      empData.totalSalesAmount += salesAmount;
      empData.totalGrossProfit += grossProfit;
      empData.storeDetails.push({
        storeCode,
        storeName: storeCode, // 可以後續對應門市名稱
        transactionCount,
        salesAmount,
        grossProfit,
        grossProfitRate
      });
    }

    console.log('員工分組後數量:', employeeMap.size);
    console.log('員工代號列表:', Array.from(employeeMap.keys()));

    // 更新資料庫
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const [employeeCode, empData] of Array.from(employeeMap.entries())) {
      // 計算總毛利率
      const totalGrossProfitRate = empData.totalSalesAmount > 0 
        ? (empData.totalGrossProfit / empData.totalSalesAmount) * 100 
        : 0;

      // 獲取該員工在該月的所有門市資料
      const { data: staffRecords, error: fetchError } = await supabase
        .from('monthly_staff_status')
        .select('id, store_id')
        .eq('year_month', yearMonth)
        .eq('employee_code', employeeCode);

      if (fetchError) {
        errors.push(`員工 ${employeeCode} 查詢失敗: ${fetchError.message}`);
        console.error(`員工 ${employeeCode} 查詢失敗:`, fetchError);
        continue;
      }

      if (!staffRecords || staffRecords.length === 0) {
        console.log(`跳過員工 ${employeeCode} (${empData.employeeName}) - 在 ${yearMonth} 找不到記錄`);
        skippedCount++;
        continue;
      }

      // 更新每個門市的員工記錄（都顯示合併後的總業績）
      for (const record of staffRecords) {
        const { error: updateError } = await supabase
          .from('monthly_staff_status')
          .update({
            transaction_count: empData.totalTransactionCount,
            sales_amount: empData.totalSalesAmount,
            gross_profit: empData.totalGrossProfit,
            gross_profit_rate: Math.round(totalGrossProfitRate * 100) / 100,
            updated_at: new Date().toISOString()
          })
          .eq('id', record.id);

        if (updateError) {
          errors.push(`員工 ${employeeCode} 更新失敗: ${updateError.message}`);
          continue;
        }

        // 刪除舊的業績明細
        await supabase
          .from('monthly_performance_details')
          .delete()
          .eq('staff_status_id', record.id);

        // 如果有多個門市，插入明細資料
        if (empData.storeDetails.length > 1) {
          const detailsToInsert = empData.storeDetails.map(detail => ({
            staff_status_id: record.id,
            store_code: detail.storeCode,
            store_name: detail.storeName,
            transaction_count: detail.transactionCount,
            sales_amount: detail.salesAmount,
            gross_profit: detail.grossProfit,
            gross_profit_rate: Math.round(detail.grossProfitRate * 100) / 100
          }));

          const { error: insertError } = await supabase
            .from('monthly_performance_details')
            .insert(detailsToInsert);

          if (insertError) {
            errors.push(`員工 ${employeeCode} 明細插入失敗: ${insertError.message}`);
          }
        }
      }

      console.log(`成功更新員工 ${employeeCode} (${empData.employeeName}) - ${staffRecords.length} 筆記錄`);
      updatedCount += staffRecords.length;
    }

    console.log('匯入結果:', { updatedCount, skippedCount, errors: errors.length });

    return NextResponse.json({
      success: true,
      message: `匯入完成`,
      updated: updatedCount,
      skipped: skippedCount,
      total: data.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error: any) {
    console.error('Import performance error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '匯入失敗' },
      { status: 500 }
    );
  }
}
