import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';
import { parseSalesRows, readSalesRows, validateSalesSheet } from '@/lib/relationships/sales-import';

/**
 * workspace 的銷售明細匯入（M6 P07 A7）：欄位驗證、日期規則與舊 /api/relationship-sales/import 相同（共用 lib/relationships/sales-import.ts），
 * 差別只有「內容完全相同的明細自動略過」：整份檔案交給資料庫函式 workspace_import_relationship_sales，
 * 在同一個交易內以 advisory lock 序列化後去重與寫入，所以並行匯入同一份檔案也不會產生重複。
 * 回傳 { success, imported, skipped }；全部重複時不建立批次（imported 為 0）。舊 route 不動。
 */
export async function importRelationshipSales(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const permission = await requirePermission(user.id, 'relationship_member.edit');
  if (!permission.allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '請選擇 .xlsx 檔案' }, { status: 400 });
  if (!file.name.toLowerCase().endsWith('.xlsx')) return NextResponse.json({ error: '僅支援 .xlsx 格式' }, { status: 400 });

  const rows = readSalesRows(Buffer.from(await file.arrayBuffer()));
  if (!rows) return NextResponse.json({ error: 'Excel 檔案無法解析' }, { status: 400 });
  const sheetError = validateSalesSheet(rows);
  if (sheetError) return NextResponse.json({ error: sheetError }, { status: 400 });

  const { validRows, errors } = parseSalesRows(rows);
  if (errors.length) {
    return NextResponse.json({ error: errors.slice(0, 10).join('\n'), error_count: errors.length }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('workspace_import_relationship_sales', {
    p_file_name: file.name,
    p_user: user.id,
    p_rows: validRows.map((row) => ({
      store_code: row.storeCode,
      sale_datetime: row.saleDatetime,
      member_number: row.memberNumber,
      product_code: row.productCode,
      product_name: row.productName,
      quantity: row.quantity,
      amount: row.amount,
    })),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const result = (data || {}) as { imported?: number; skipped?: number; import_id?: string | null };
  return NextResponse.json({ success: true, imported: Number(result.imported || 0), skipped: Number(result.skipped || 0) });
}
