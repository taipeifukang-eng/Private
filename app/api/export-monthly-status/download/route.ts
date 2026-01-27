import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

// 職位排序優先順序（與 POSITION_OPTIONS 一致）
const POSITION_ORDER: { [key: string]: number } = {
  '督導': 1,
  '店長': 2,
  '代理店長': 3,
  '督導(代理店長)': 4,
  '副店長': 5,
  '主任': 6,
  '組長': 7,
  '專員': 8,
  '新人': 9,
  '行政': 10,
  '兼職專員': 11,
  '兼職藥師': 12,
  '兼職藥師專員': 13,
  '兼職助理': 14
};

// 計算人員階段
function calculateStage(position: string, newbieLevel: string | null): string {
  // 1. 專員以上都是三階
  const seniorPositions = ['督導', '店長', '代理店長', '督導(代理店長)', '副店長', '主任', '組長', '專員'];
  if (seniorPositions.includes(position)) {
    return '三階';
  }

  // 2. 新人根據階段
  if (position === '新人') {
    if (newbieLevel === '二階新人') return '二階';
    if (newbieLevel === '一階新人') return '一階';
    return '未過一階'; // 未過階新人或null
  }

  // 3. 行政
  if (position === '行政') {
    if (newbieLevel === '過階行政') return '行政(過階)';
    return '行政(未過階)'; // 未過階行政或null
  }

  // 4. 兼職專員
  if (position === '兼職專員') {
    return '三階';
  }

  // 5. 兼職藥師
  if (position === '兼職藥師') {
    return '未過階';
  }

  // 6. 兼職藥師專員
  if (position === '兼職藥師專員') {
    return '三階';
  }

  // 7. 兼職助理
  if (position === '兼職助理') {
    return '未過階';
  }

  return '';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    // 權限檢查：admin 或營業部主管
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager';
    if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor)) {
      return NextResponse.json(
        { success: false, error: '權限不足' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { year_month, store_ids } = body;

    if (!year_month || !store_ids || !Array.isArray(store_ids) || store_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: '參數錯誤' },
        { status: 400 }
      );
    }

    // 獲取所有選中門市的員工資料（不在資料庫層排序職位，稍後在程式中處理）
    const { data: staffData, error: staffError } = await supabase
      .from('monthly_staff_status')
      .select(`
        *,
        stores:store_id (store_code, store_name)
      `)
      .in('store_id', store_ids)
      .eq('year_month', year_month)
      .order('store_id');

    if (staffError) {
      console.error('Error fetching staff data:', staffError);
      return NextResponse.json(
        { success: false, error: '獲取資料失敗' },
        { status: 500 }
      );
    }

    // 在程式中進行排序：先門市代號，再職位順序
    const sortedData = (staffData || []).sort((a: any, b: any) => {
      // 1. 先按門市代號排序
      const storeCodeA = a.stores?.store_code || '';
      const storeCodeB = b.stores?.store_code || '';
      if (storeCodeA !== storeCodeB) {
        return storeCodeA.localeCompare(storeCodeB);
      }

      // 2. 再按職位順序排序
      const positionA = a.position || '';
      const positionB = b.position || '';
      const orderA = POSITION_ORDER[positionA] || 999;
      const orderB = POSITION_ORDER[positionB] || 999;
      
      return orderA - orderB;
    });

    // 轉換資料為 Excel 格式
    const excelData = sortedData.map((record: any) => {
      // 計算區塊處理 - 直接顯示數字
      let calculationBlock = '';
      if (record.calculated_block) {
        calculationBlock = record.calculated_block.toString();
      }

      // 職位名稱處理：如果是雙職務，在職位後加上"-雙"
      let positionName = record.position || '';
      if (record.is_dual_position) {
        positionName += '-雙';
      }

      // 天數顯示邏輯：只有未上滿整月的才顯示天數
      let workDays = '';
      if (record.monthly_status !== 'full_month' && record.work_days) {
        workDays = record.work_days.toString();
      }

      // 計算階段
      const stage = calculateStage(record.position || '', record.newbie_level);

      // 當月個人實際毛利（四捨五入到整數）
      const grossProfit = record.gross_profit ? Math.round(record.gross_profit) : '';

      return {
        '門市代碼': record.stores?.store_code || '',
        '月份': year_month, // 完整年月格式 YYYY-MM
        '員工代號': record.employee_code || '',
        '員工姓名': record.employee_name || '',
        '計算區塊': calculationBlock,
        '職位': positionName,
        '當月個人實際毛利': grossProfit, // 第7欄：當月個人實際毛利
        '階段': stage, // 第8欄：階段
        '時數': record.work_hours || '', // 使用正確的欄位名稱
        '天數': workDays // 只在未上滿整月時顯示
      };
    });

    // 創建 Excel 工作簿
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // 設置列寬
    const columnWidths = [
      { wch: 12 }, // 門市代碼
      { wch: 10 }, // 月份
      { wch: 12 }, // 員工代號
      { wch: 12 }, // 員工姓名
      { wch: 12 }, // 計算區塊
      { wch: 15 }, // 職位
      { wch: 18 }, // 當月個人實際毛利
      { wch: 15 }, // 階段
      { wch: 8 },  // 時數
      { wch: 8 }   // 天數
    ];
    worksheet['!cols'] = columnWidths;

    // 添加工作表
    XLSX.utils.book_append_sheet(workbook, worksheet, '每月人員狀態');

    // 生成 Excel 檔案
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // 返回檔案
    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="monthly_staff_status_${year_month}.xlsx"`
      }
    });

  } catch (error) {
    console.error('Error generating Excel:', error);
    return NextResponse.json(
      { success: false, error: '生成 Excel 失敗' },
      { status: 500 }
    );
  }
}
