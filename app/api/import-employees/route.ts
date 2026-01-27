import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

interface EmployeeRow {
  門市代號?: string;
  員編?: string;
  姓名?: string;
  職位?: string;
  到職日期?: string;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '未選擇檔案' },
        { status: 400 }
      );
    }

    // 讀取檔案
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 解析 Excel 檔案
    const workbook: XLSX.WorkBook = XLSX.read(buffer, { type: 'buffer' });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: EmployeeRow[] = XLSX.utils.sheet_to_json(worksheet);

    if (!data || data.length === 0) {
      return NextResponse.json(
        { success: false, error: '檔案中沒有資料' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // 取得所有門市資料（用於驗證門市代號）
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('id, store_code')
      .eq('is_active', true);

    if (storesError) {
      console.error('Error fetching stores:', storesError);
      return NextResponse.json(
        { success: false, error: '無法取得門市資料' },
        { status: 500 }
      );
    }

    const storeMap = new Map(stores?.map(s => [s.store_code, s.id]) || []);

    // 處理每一列資料
    const results = {
      imported: 0,
      failed: 0,
      errors: [] as Array<{
        row: number;
        employee_code: string;
        employee_name: string;
        error: string;
      }>
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNumber = i + 2; // Excel 列號（從2開始，因為第1列是標題）

      try {
        // 驗證必填欄位
        if (!row.門市代號) {
          throw new Error('缺少門市代號');
        }
        if (!row.員編) {
          throw new Error('缺少員編');
        }
        if (!row.姓名) {
          throw new Error('缺少姓名');
        }
        if (!row.職位) {
          throw new Error('缺少職位');
        }
        if (!row.到職日期) {
          throw new Error('缺少到職日期');
        }

        // 驗證門市代號
        const storeId = storeMap.get(row.門市代號.trim());
        if (!storeId) {
          throw new Error(`門市代號 "${row.門市代號}" 不存在`);
        }

        // 解析日期
        let startDate: string;
        const dateValue = row.到職日期;
        
        if (typeof dateValue === 'number') {
          // Excel 日期序號
          const excelDate = XLSX.SSF.parse_date_code(dateValue);
          startDate = `${excelDate.y}-${String(excelDate.m).padStart(2, '0')}-${String(excelDate.d).padStart(2, '0')}`;
        } else if (typeof dateValue === 'string') {
          // 字串格式
          const cleanDate = dateValue.trim();
          // 支援多種日期格式
          if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleanDate)) {
            const parts = cleanDate.split('-');
            startDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
          } else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(cleanDate)) {
            const parts = cleanDate.split('/');
            startDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
          } else {
            throw new Error(`日期格式錯誤："${dateValue}"，請使用 YYYY-MM-DD 格式`);
          }
        } else {
          throw new Error(`無法解析日期："${dateValue}"`);
        }

        // 檢查員編是否重複
        const { data: existingEmployee } = await supabase
          .from('store_employees')
          .select('id')
          .eq('employee_code', row.員編.trim())
          .single();

        if (existingEmployee) {
          throw new Error(`員編 "${row.員編}" 已存在`);
        }

        // 插入員工資料
        const { error: insertError } = await supabase
          .from('store_employees')
          .insert({
            store_id: storeId,
            employee_code: row.員編.trim(),
            employee_name: row.姓名.trim(),
            position: row.職位.trim(),
            start_date: startDate,
            employment_type: 'full_time', // 預設為正職，之後可編輯
            is_active: true
          });

        if (insertError) {
          throw new Error(insertError.message);
        }

        results.imported++;
      } catch (error: any) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          employee_code: row.員編 || '未知',
          employee_name: row.姓名 || '未知',
          error: error.message || '未知錯誤'
        });
      }
    }

    return NextResponse.json({
      success: true,
      imported: results.imported,
      failed: results.failed,
      errors: results.errors
    });

  } catch (error: any) {
    console.error('Error importing employees:', error);
    return NextResponse.json(
      { success: false, error: error.message || '匯入失敗' },
      { status: 500 }
    );
  }
}
