import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

type SaleRow = {
  id: string;
  store_code: string | null;
  product_code: string | null;
  product_name: string | null;
  quantity: number | null;
  gross_profit: number | null;
  total_amount: number | null;
  employee_code: string | null;
  employee_name: string | null;
  member_code: string | null;
  member_name: string | null;
  stores?: { store_code?: string | null; store_name?: string | null } | { store_code?: string | null; store_name?: string | null }[] | null;
};

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStore(row: SaleRow) {
  const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
  return {
    code: store?.store_code || row.store_code || '',
    name: store?.store_name || '',
  };
}

function sameText(left: string | null | undefined, right: string) {
  return String(left || '').trim() === right.trim();
}

async function loadRowsByField(yearMonth: string, field: 'employee_code' | 'member_code' | 'employee_name' | 'member_name', value: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('employee_purchase_sales')
    .select(`
      id,
      store_code,
      product_code,
      product_name,
      quantity,
      gross_profit,
      total_amount,
      employee_code,
      employee_name,
      member_code,
      member_name,
      stores:store_id (store_code, store_name)
    `)
    .eq('year_month', yearMonth)
    .eq(field, value)
    .limit(5000);

  if (error) throw error;
  return (data || []) as SaleRow[];
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const allowed = await hasAnyPermission(user.id, ['employee_purchase.view', 'employee_purchase.import']);
    if (!allowed) {
      return NextResponse.json({ success: false, error: '無員工購物管理權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('year_month') || '';
    const employeeCode = (searchParams.get('employee_code') || '').trim();
    const employeeName = (searchParams.get('employee_name') || '').trim();

    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, error: '月份格式錯誤' }, { status: 400 });
    }
    if (!employeeCode && !employeeName) {
      return NextResponse.json({ success: false, error: '缺少員工識別資料' }, { status: 400 });
    }

    const candidates: SaleRow[] = [];
    if (employeeCode) {
      candidates.push(...await loadRowsByField(yearMonth, 'employee_code', employeeCode));
      candidates.push(...await loadRowsByField(yearMonth, 'member_code', employeeCode));
    }
    if (!employeeCode && employeeName) {
      candidates.push(...await loadRowsByField(yearMonth, 'employee_name', employeeName));
      candidates.push(...await loadRowsByField(yearMonth, 'member_name', employeeName));
    }

    const uniqueRows = Array.from(new Map(candidates.map((row) => [row.id, row])).values())
      .filter((row) => {
        if (employeeCode) {
          return sameText(row.employee_code, employeeCode) || sameText(row.member_code, employeeCode);
        }
        return sameText(row.employee_name, employeeName) || sameText(row.member_name, employeeName);
      });

    const detailMap = new Map<string, {
      purchase_store_code: string;
      purchase_store_name: string;
      product_code: string;
      product_name: string;
      purchase_count: number;
      quantity: number;
      gross_profit: number;
      total_amount: number;
    }>();

    uniqueRows.forEach((row) => {
      const store = getStore(row);
      const productCode = row.product_code || '';
      const productName = row.product_name || '';
      const key = `${store.code}::${productCode}::${productName}`;
      const detail = detailMap.get(key) || {
        purchase_store_code: store.code,
        purchase_store_name: store.name,
        product_code: productCode,
        product_name: productName,
        purchase_count: 0,
        quantity: 0,
        gross_profit: 0,
        total_amount: 0,
      };
      detail.purchase_count += 1;
      detail.quantity += toNumber(row.quantity);
      detail.gross_profit += toNumber(row.gross_profit);
      detail.total_amount += toNumber(row.total_amount);
      detailMap.set(key, detail);
    });

    const details = Array.from(detailMap.values())
      .sort((a, b) => {
        const storeCompare = a.purchase_store_code.localeCompare(b.purchase_store_code, 'zh-Hant-TW', { numeric: true });
        if (storeCompare !== 0) return storeCompare;
        return b.total_amount - a.total_amount;
      });

    return NextResponse.json({
      success: true,
      details,
      total_amount: details.reduce((sum, row) => sum + row.total_amount, 0),
      total_gross_profit: details.reduce((sum, row) => sum + row.gross_profit, 0),
      total_quantity: details.reduce((sum, row) => sum + row.quantity, 0),
      purchase_count: uniqueRows.length,
    });
  } catch (error: any) {
    console.error('Error loading employee purchase details:', error);
    return NextResponse.json({ success: false, error: error.message || '載入員工購買明細失敗' }, { status: 500 });
  }
}
