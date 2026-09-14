import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';
import * as XLSX from 'xlsx';

type RosterRow = {
  year_month: string;
  store_code: string;
  store_name: string;
  employee_code: string;
  employee_name: string;
  position: string;
  monthly_status: string;
};

function extractStoreRelation(storesValue: any) {
  return Array.isArray(storesValue) ? storesValue[0] : storesValue;
}

function normalizeStoreCode(raw: string | null | undefined) {
  return String(raw || '').trim();
}

function buildRosterRows(records: any[], yearMonth: string): RosterRow[] {
  return (records || [])
    .map((record: any) => {
      const store = extractStoreRelation(record.stores);
      return {
        year_month: yearMonth,
        store_code: normalizeStoreCode(store?.store_code),
        store_name: store?.store_name || '',
        employee_code: record.employee_code || '',
        employee_name: record.employee_name || '',
        position: record.position || '',
        monthly_status: record.monthly_status || '',
      };
    })
    .sort((a, b) => {
      const storeCompare = a.store_code.localeCompare(b.store_code, 'zh-Hant-TW', { numeric: true });
      if (storeCompare !== 0) return storeCompare;
      return a.employee_code.localeCompare(b.employee_code, 'zh-Hant-TW', { numeric: true });
    });
}

async function loadRoster(yearMonth: string, storeIds: string[]) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('monthly_staff_status')
    .select(`
      year_month,
      store_id,
      employee_code,
      employee_name,
      position,
      monthly_status,
      stores:store_id (store_code, store_name)
    `)
    .eq('year_month', yearMonth)
    .in('store_id', storeIds)
    .order('store_id')
    .order('employee_code');

  if (error) {
    throw error;
  }

  return buildRosterRows(data || [], yearMonth);
}

async function assertCanExport() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
  }

  const permission = await requirePermission(user.id, 'monthly.export.download');
  if (!permission.allowed) {
    return NextResponse.json({ success: false, error: permission.message }, { status: 403 });
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const denied = await assertCanExport();
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('year_month') || '';
    const storeIds = (searchParams.get('store_ids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!/^\d{4}-\d{2}$/.test(yearMonth) || storeIds.length === 0) {
      return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 });
    }

    const rows = await loadRoster(yearMonth, storeIds);
    return NextResponse.json({ success: true, rows });
  } catch (error: any) {
    console.error('Error loading monthly staff roster:', error);
    return NextResponse.json({ success: false, error: error.message || '載入名冊失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await assertCanExport();
    if (denied) return denied;

    const body = await request.json();
    const yearMonth = body?.year_month || '';
    const storeIds = Array.isArray(body?.store_ids) ? body.store_ids.filter(Boolean) : [];

    if (!/^\d{4}-\d{2}$/.test(yearMonth) || storeIds.length === 0) {
      return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 });
    }

    const rows = await loadRoster(yearMonth, storeIds);
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
      '月份': row.year_month,
      '門市代號': row.store_code,
      '門市名稱': row.store_name,
      '員編': row.employee_code,
      '姓名': row.employee_name,
      '職稱': row.position,
      '月份狀態': row.monthly_status,
    })));
    worksheet['!cols'] = [
      { wch: 10 },
      { wch: 12 },
      { wch: 18 },
      { wch: 12 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, '每月門市人員名冊');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="monthly_staff_roster_${yearMonth}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error('Error exporting monthly staff roster:', error);
    return NextResponse.json({ success: false, error: error.message || '匯出名冊失敗' }, { status: 500 });
  }
}
