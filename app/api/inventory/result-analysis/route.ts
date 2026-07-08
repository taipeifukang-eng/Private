import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const REQUIRED_COLUMNS = [
  '店號',
  '店名',
  '盤點單號',
  '結案?',
  '品號',
  '品名',
  '單位',
  '儲位1',
  '儲位2',
  '盤差量',
  '盤差額(會員)',
  '成本',
  '單位成本',
  '庫存量',
  '庫存額',
] as const;

function normalizeStoreCode(code: unknown): string {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function getStoreCodeBase(code: string): string {
  const normalized = normalizeStoreCode(code);
  const match = normalized.match(/^\d+/);
  return match ? match[0] : normalized;
}

function getStr(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value).trim();
}

function getNum(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function ensurePermission(userId: string): Promise<boolean> {
  return (await hasPermission(userId, 'inventory.inventory.access'))
    || (await hasPermission(userId, 'inventory.inventory.view'))
    || (await hasPermission(userId, 'inventory.manage'));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    if (!(await ensurePermission(user.id))) {
      return NextResponse.json({ success: false, error: '無查看盤點結果分析報表權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const storeKeyword = (searchParams.get('store') || '').trim();
    const orderKeyword = (searchParams.get('order_no') || '').trim();
    const batchId = searchParams.get('batch_id') || '';

    const admin = createAdminClient();

    let q = admin
      .from('inventory_result_batches')
      .select(`
        *,
        store:stores(id, store_code, store_name)
      `)
      .order('imported_at', { ascending: false })
      .limit(50);

    if (batchId) q = q.eq('id', batchId);
    if (orderKeyword) q = q.ilike('inventory_order_no', `%${orderKeyword}%`);
    if (storeKeyword) {
      q = q.or(`store_code.ilike.%${storeKeyword}%,store_name.ilike.%${storeKeyword}%`);
    }

    const { data: batches, error: batchError } = await q;
    if (batchError) {
      return NextResponse.json({ success: false, error: batchError.message }, { status: 500 });
    }

    const selectedBatchId = batchId || batches?.[0]?.id || '';
    let items: any[] = [];

    if (selectedBatchId) {
      const { data: itemRows, error: itemError } = await admin
        .from('inventory_result_items')
        .select('*')
        .eq('batch_id', selectedBatchId)
        .order('difference_amount_member', { ascending: true })
        .limit(200);

      if (itemError) {
        return NextResponse.json({ success: false, error: itemError.message }, { status: 500 });
      }
      items = itemRows || [];
    }

    return NextResponse.json({ success: true, batches: batches || [], items, selected_batch_id: selectedBatchId });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    if (!(await ensurePermission(user.id))) {
      return NextResponse.json({ success: false, error: '無匯入盤點結果分析報表權限' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ success: false, error: '缺少匯入檔案' }, { status: 400 });

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Excel 無資料' }, { status: 400 });
    }

    const actualColumns = Object.keys(rows[0] || {});
    const missingColumns = REQUIRED_COLUMNS.filter((col) => !actualColumns.includes(col));
    if (missingColumns.length > 0) {
      return NextResponse.json({
        success: false,
        error: `缺少必要欄位：${missingColumns.join('、')}`,
        actualColumns,
      }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: stores, error: storesError } = await admin
      .from('stores')
      .select('id, store_code, store_name')
      .eq('is_active', true);

    if (storesError) {
      return NextResponse.json({ success: false, error: storesError.message }, { status: 500 });
    }

    const storeCodeMap = new Map<string, any>();
    const storeBaseMap = new Map<string, any[]>();
    (stores || []).forEach((store: any) => {
      const code = normalizeStoreCode(store.store_code);
      const base = getStoreCodeBase(code);
      storeCodeMap.set(code, store);
      storeBaseMap.set(base, [...(storeBaseMap.get(base) || []), store]);
    });

    const groups = new Map<string, { store: any; orderNo: string; rows: Record<string, unknown>[] }>();
    const errors: string[] = [];

    rows.forEach((row, index) => {
      const rowLabel = `第 ${index + 2} 列`;
      const rawStoreCode = getStr(row, '店號');
      const orderNo = getStr(row, '盤點單號');

      if (!rawStoreCode) {
        errors.push(`${rowLabel}：缺少店號`);
        return;
      }
      if (!orderNo) {
        errors.push(`${rowLabel}：缺少盤點單號`);
        return;
      }

      const normalizedCode = normalizeStoreCode(rawStoreCode);
      const candidates = storeBaseMap.get(getStoreCodeBase(normalizedCode)) || [];
      const store = storeCodeMap.get(normalizedCode) || candidates[0];
      if (!store) {
        errors.push(`${rowLabel}：找不到門市店號「${rawStoreCode}」`);
        return;
      }

      const key = `${store.id}|${orderNo}`;
      const group = groups.get(key) || { store, orderNo, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    });

    if (groups.size === 0) {
      return NextResponse.json({ success: false, error: `沒有可匯入資料。${errors.join('；')}` }, { status: 400 });
    }

    const importedBatches: any[] = [];

    for (const group of Array.from(groups.values())) {
      const rowCount = group.rows.length;
      const totalDifferenceQty = group.rows.reduce((sum: number, row: Record<string, unknown>) => sum + getNum(row, '盤差量'), 0);
      const totalDifferenceAmount = group.rows.reduce((sum: number, row: Record<string, unknown>) => sum + getNum(row, '盤差額(會員)'), 0);
      const shortageCount = group.rows.filter((row: Record<string, unknown>) => getNum(row, '盤差量') < 0).length;
      const surplusCount = group.rows.filter((row: Record<string, unknown>) => getNum(row, '盤差量') > 0).length;
      const zeroDifferenceCount = group.rows.filter((row: Record<string, unknown>) => getNum(row, '盤差量') === 0).length;
      const closedTexts = Array.from(new Set(group.rows.map((row: Record<string, unknown>) => getStr(row, '結案?')).filter(Boolean)));

      const { data: batch, error: batchError } = await admin
        .from('inventory_result_batches')
        .upsert({
          store_id: group.store.id,
          store_code: group.store.store_code,
          store_name: getStr(group.rows[0], '店名') || group.store.store_name,
          inventory_order_no: group.orderNo,
          closed_text: closedTexts.join('、') || null,
          source_file_name: file.name,
          imported_by: user.id,
          imported_at: new Date().toISOString(),
          row_count: rowCount,
          total_difference_qty: totalDifferenceQty,
          total_difference_amount_member: totalDifferenceAmount,
          shortage_count: shortageCount,
          surplus_count: surplusCount,
          zero_difference_count: zeroDifferenceCount,
        }, { onConflict: 'store_id,inventory_order_no' })
        .select('id, store_code, store_name, inventory_order_no')
        .single();

      if (batchError) {
        return NextResponse.json({ success: false, error: batchError.message }, { status: 500 });
      }

      await admin.from('inventory_result_items').delete().eq('batch_id', batch.id);

      const itemPayload = group.rows.map((row: Record<string, unknown>, index: number) => ({
        batch_id: batch.id,
        store_id: group.store.id,
        row_number: index + 2,
        closed_text: getStr(row, '結案?') || null,
        product_code: getStr(row, '品號'),
        product_name: getStr(row, '品名'),
        unit: getStr(row, '單位') || null,
        storage_location_1: getStr(row, '儲位1') || null,
        storage_location_2: getStr(row, '儲位2') || null,
        difference_qty: getNum(row, '盤差量'),
        difference_amount_member: getNum(row, '盤差額(會員)'),
        cost: getNum(row, '成本'),
        unit_cost: getNum(row, '單位成本'),
        stock_qty: getNum(row, '庫存量'),
        stock_amount: getNum(row, '庫存額'),
        raw_data: row,
      }));

      const { error: itemsError } = await admin
        .from('inventory_result_items')
        .insert(itemPayload);

      if (itemsError) {
        return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
      }

      importedBatches.push({ ...batch, row_count: rowCount });
    }

    return NextResponse.json({
      success: true,
      imported_batches: importedBatches.length,
      imported_rows: rows.length - errors.length,
      batches: importedBatches,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
