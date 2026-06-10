import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission, requirePermission } from '@/lib/permissions/check';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

function getMonthRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
  const endDate = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { startDate, endDate };
}

function formatInspectionDate(dateValue?: string | null) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-TW');
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const permission = await requirePermission(user.id, 'inspection.export');
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.message || '權限不足' }, { status: 403 });
    }

    const monthParam = request.nextUrl.searchParams.get('month');
    const defaultMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : defaultMonth;
    const { startDate, endDate } = getMonthRange(month);

    const [viewAllAllowed, profileResult] = await Promise.all([
      hasPermission(user.id, 'inspection.view_all'),
      supabase.from('profiles').select('id, role').eq('id', user.id).single(),
    ]);

    if (profileResult.error || !profileResult.data) {
      return NextResponse.json({ error: '找不到使用者資料' }, { status: 404 });
    }

    const isAdmin = profileResult.data.role === 'admin';

    let stores: any[] = [];

    if (viewAllAllowed || isAdmin) {
      const { data: allStores, error: allStoresError } = await supabase
        .from('stores')
        .select('id, store_code, short_name, store_name')
        .eq('is_active', true)
        .order('store_code', { ascending: true });

      if (allStoresError) {
        return NextResponse.json({ error: `取得門市資料失敗: ${allStoresError.message}` }, { status: 500 });
      }

      stores = allStores || [];
    } else {
      const { data: assignments, error: assignmentError } = await supabase
        .from('store_managers')
        .select('store_id')
        .eq('user_id', user.id);

      if (assignmentError) {
        return NextResponse.json({ error: `取得門市指派失敗: ${assignmentError.message}` }, { status: 500 });
      }

      const storeIds = Array.from(new Set((assignments || []).map((item: any) => item.store_id).filter(Boolean)));

      if (storeIds.length > 0) {
        const { data: myStores, error: myStoresError } = await supabase
          .from('stores')
          .select('id, store_code, short_name, store_name')
          .in('id', storeIds)
          .eq('is_active', true)
          .order('store_code', { ascending: true });

        if (myStoresError) {
          return NextResponse.json({ error: `取得門市資料失敗: ${myStoresError.message}` }, { status: 500 });
        }

        stores = myStores || [];
      }
    }

    const storeIds = stores.map((store: any) => store.id).filter(Boolean);
    let inspections: any[] = [];

    if (storeIds.length > 0) {
      const { data: inspectionData, error: inspectionError } = await supabase
        .from('inspection_masters')
        .select('store_id, inspection_date, grade, created_at, inspection_type')
        .gte('inspection_date', startDate)
        .lt('inspection_date', endDate)
        .or('inspection_type.eq.supervisor,inspection_type.is.null')
        .in('store_id', storeIds)
        .order('inspection_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (inspectionError) {
        return NextResponse.json({ error: `取得巡店資料失敗: ${inspectionError.message}` }, { status: 500 });
      }

      inspections = inspectionData || [];
    }

    const latestInspectionByStore = new Map<string, any>();
    for (const inspection of inspections) {
      if (!latestInspectionByStore.has(inspection.store_id)) {
        latestInspectionByStore.set(inspection.store_id, inspection);
      }
    }

    const rows = stores.map((store: any) => {
      const latestInspection = latestInspectionByStore.get(store.id);
      const parsedScore = Number.parseInt(latestInspection?.grade || '0', 10);

      return {
        門市代碼: store.store_code || '',
        門市簡稱: store.short_name || store.store_name || '',
        得分數: Number.isFinite(parsedScore) ? parsedScore : 0,
        巡店日期: formatInspectionDate(latestInspection?.inspection_date),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 14 },
      { wch: 18 },
      { wch: 10 },
      { wch: 14 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '巡店得分');

    const excelBuffer = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
      bookSST: false,
    });

    const filename = encodeURIComponent(`督導巡店得分_${month}.xlsx`);

    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (error: any) {
    console.error('匯出督導巡店得分失敗:', error);
    return NextResponse.json({ error: error.message || '匯出失敗' }, { status: 500 });
  }
}
