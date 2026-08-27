import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';
import { buildHistoricalStoreCodeMap } from '@/lib/store/historical';
import {
  calculateActualStaffPoint,
  MONTHLY_STATUS_LABELS,
} from '@/lib/monthly-staff/actual-staff-points';
import * as XLSX from 'xlsx';

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    const permission = await requirePermission(user.id, 'monthly.export.download');
    if (!permission.allowed) {
      return NextResponse.json(
        { success: false, error: permission.message },
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

    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('id, store_code, store_name')
      .in('id', store_ids);

    if (storesError) {
      console.error('Error fetching stores:', storesError);
      return NextResponse.json(
        { success: false, error: '獲取門市資料失敗' },
        { status: 500 }
      );
    }

    const { data: summaries, error: summariesError } = await supabase
      .from('monthly_store_summary')
      .select('store_id, year_month, business_days, total_employees, status')
      .eq('year_month', year_month)
      .in('store_id', store_ids);

    if (summariesError) {
      console.error('Error fetching monthly summaries:', summariesError);
      return NextResponse.json(
        { success: false, error: '獲取門市每月摘要失敗' },
        { status: 500 }
      );
    }

    const { data: staffData, error: staffError } = await supabase
      .from('monthly_staff_status')
      .select(`
        id,
        year_month,
        store_id,
        employee_code,
        employee_name,
        position,
        employment_type,
        is_pharmacist,
        monthly_status,
        work_days,
        total_days_in_month,
        work_hours,
        newbie_level,
        partial_month_reason,
        is_dual_position,
        is_acting_manager,
        is_supervisor_rotation,
        supervisor_shift_hours,
        extra_tasks,
        extra_task_planned_hours,
        extra_task_external_hours,
        special_role,
        calculated_block,
        status
      `)
      .eq('year_month', year_month)
      .in('store_id', store_ids)
      .order('store_id');

    if (staffError) {
      console.error('Error fetching monthly staff:', staffError);
      return NextResponse.json(
        { success: false, error: '獲取每月人員資料失敗' },
        { status: 500 }
      );
    }

    const codeMap = await buildHistoricalStoreCodeMap(supabase, store_ids, year_month);
    const storeById = new Map((stores || []).map((store: any) => [store.id, store]));
    const summaryByStoreId = new Map((summaries || []).map((summary: any) => [summary.store_id, summary]));

    const getDefaultMonthDays = () => {
      const [year, month] = String(year_month).split('-').map(Number);
      if (!year || !month) return 30;
      return new Date(year, month, 0).getDate();
    };

    const defaultMonthDays = getDefaultMonthDays();
    const getBusinessDays = (storeId: string) => {
      const summary = summaryByStoreId.get(storeId);
      const businessDays = Number(summary?.business_days || 0);
      if (businessDays > 0) return businessDays;

      const staffRows = (staffData || []).filter((row: any) => row.store_id === storeId);
      const totalDays = Math.max(
        ...staffRows.map((row: any) => Number(row.total_days_in_month || 0)),
        defaultMonthDays
      );
      return totalDays || 30;
    };

    const sortedStaff = [...(staffData || [])].sort((a: any, b: any) => {
      const storeCodeA = codeMap[a.store_id] || storeById.get(a.store_id)?.store_code || '';
      const storeCodeB = codeMap[b.store_id] || storeById.get(b.store_id)?.store_code || '';
      if (storeCodeA !== storeCodeB) return storeCodeA.localeCompare(storeCodeB);

      const employeeCodeA = a.employee_code || '';
      const employeeCodeB = b.employee_code || '';
      return employeeCodeA.localeCompare(employeeCodeB);
    });

    const storeTotals = new Map<string, {
      staffCount: number;
      pointTotal: number;
      reviewCount: number;
      reviewNotes: Set<string>;
    }>();

    const detailRows = sortedStaff.map((record: any) => {
      const store = storeById.get(record.store_id);
      const businessDays = getBusinessDays(record.store_id);
      const result = calculateActualStaffPoint(record, businessDays);
      const total = storeTotals.get(record.store_id) || {
        staffCount: 0,
        pointTotal: 0,
        reviewCount: 0,
        reviewNotes: new Set<string>(),
      };

      total.staffCount += 1;
      total.pointTotal += result.point;
      if (result.needsReview) {
        total.reviewCount += 1;
        total.reviewNotes.add(result.needsReview);
      }
      storeTotals.set(record.store_id, total);

      return {
        '門市代碼': codeMap[record.store_id] || store?.store_code || '',
        '門市名稱': store?.store_name || '',
        '月份': year_month,
        '員工代號': record.employee_code || '',
        '員工姓名': record.employee_name || '',
        '職位': result.positionName,
        '階段': result.stage,
        '雇用類型': record.employment_type === 'part_time' ? '兼職' : '正職',
        '本月狀態': result.statusLabel,
        '工作天數': result.adoptedWorkDays || '',
        '當月營業天數': result.businessDays,
        '採用時數': result.adoptedHours || '',
        '時數來源': result.adoptedHours ? result.adoptedHoursSource : '',
        '實際人力點值': result.point,
        '計算規則': result.rule,
        '需確認': result.needsReview,
        '未整月原因': record.partial_month_reason || '',
        '計算區塊': record.calculated_block || '',
        '審核狀態': record.status || '',
        '特殊任務': Array.isArray(record.extra_tasks) ? record.extra_tasks.join('、') : '',
        '特殊身分': record.special_role || '',
      };
    });

    const summaryRows = (stores || [])
      .slice()
      .sort((a: any, b: any) => {
        const storeCodeA = codeMap[a.id] || a.store_code || '';
        const storeCodeB = codeMap[b.id] || b.store_code || '';
        return storeCodeA.localeCompare(storeCodeB);
      })
      .map((store: any) => {
        const total = storeTotals.get(store.id) || {
          staffCount: 0,
          pointTotal: 0,
          reviewCount: 0,
          reviewNotes: new Set<string>(),
        };
        const summary = summaryByStoreId.get(store.id);

        return {
          '門市代碼': codeMap[store.id] || store.store_code || '',
          '門市名稱': store.store_name || '',
          '月份': year_month,
          '營業天數': getBusinessDays(store.id),
          '人員筆數': total.staffCount,
          '實際人力點值合計': Math.round(total.pointTotal * 10000) / 10000,
          '需確認筆數': total.reviewCount,
          '門市狀態': summary?.status || '',
          '需確認摘要': Array.from(total.reviewNotes).join('；'),
        };
      });

    const reviewRows = detailRows
      .filter((row) => row['需確認'])
      .map((row) => ({
        '門市代碼': row['門市代碼'],
        '門市名稱': row['門市名稱'],
        '員工代號': row['員工代號'],
        '員工姓名': row['員工姓名'],
        '職位': row['職位'],
        '本月狀態': row['本月狀態'],
        '需確認': row['需確認'],
      }));

    if (reviewRows.length === 0) {
      reviewRows.push({
        '門市代碼': '',
        '門市名稱': '',
        '員工代號': '',
        '員工姓名': '',
        '職位': '',
        '本月狀態': '',
        '需確認': '目前沒有需要依推定規則確認的人員。',
      });
    }

    const workbook = XLSX.utils.book_new();
    const summaryWorksheet = XLSX.utils.json_to_sheet(summaryRows);
    summaryWorksheet['!cols'] = [
      { wch: 12 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 60 },
    ];

    const detailWorksheet = XLSX.utils.json_to_sheet(detailRows);
    detailWorksheet['!cols'] = [
      { wch: 12 },
      { wch: 16 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 10 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 16 },
      { wch: 14 },
      { wch: 48 },
      { wch: 60 },
      { wch: 14 },
      { wch: 10 },
      { wch: 10 },
      { wch: 20 },
      { wch: 20 },
    ];

    const reviewWorksheet = XLSX.utils.json_to_sheet(reviewRows);
    reviewWorksheet['!cols'] = [
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 },
      { wch: 14 },
      { wch: 70 },
    ];

    const ruleRows = [
      { '類別': '整月在職', '規則': '專員以上職等 = 1' },
      { '類別': '整月在職', '規則': '行政(過階) = 0.5；行政(未過階) = 0' },
      { '類別': '整月在職', '規則': '新人(二階) = 0.7；新人(一階) = 0.5；新人(未過一階) = 0' },
      { '類別': '整月在職', '規則': '兼職助理(未過階) = 時數 / 160 / 2，最高 1' },
      { '類別': '整月在職', '規則': '兼職專員(三階) = 時數 / 160，最高 1' },
      { '類別': '整月在職', '規則': '兼職藥師(三階/未過階) = 時數 / 160，最高 1' },
      { '類別': '未整月在職', '規則': '專員以上職等 = 天數 / 當月營業天數，最高 1' },
      { '類別': '未整月在職', '規則': '新人(未過一階) = 0；行政(未過階) = 0' },
      { '類別': '系統推定', '規則': '未整月新人一階/二階、行政過階：依整月基準點值 × 天數 / 營業天數計算' },
      { '類別': '系統推定', '規則': '未整月兼職人員：沿用實際時數制；兼職藥師專員依時數 / 160 計算' },
      { '類別': '系統月狀態', '規則': Object.entries(MONTHLY_STATUS_LABELS).map(([value, label]) => `${value}=${label}`).join('；') },
    ];
    const ruleWorksheet = XLSX.utils.json_to_sheet(ruleRows);
    ruleWorksheet['!cols'] = [{ wch: 16 }, { wch: 100 }];

    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, '門市人力點值加總');
    XLSX.utils.book_append_sheet(workbook, detailWorksheet, '人員明細');
    XLSX.utils.book_append_sheet(workbook, reviewWorksheet, '規則待確認');
    XLSX.utils.book_append_sheet(workbook, ruleWorksheet, '計算規則');

    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const filename = encodeURIComponent(`實際人力點值_${year_month}.xlsx`);

    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (error) {
    console.error('Error generating actual staff points export:', error);
    return NextResponse.json(
      { success: false, error: '生成實際人力點值 Excel 失敗' },
      { status: 500 }
    );
  }
}
