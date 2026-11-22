import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';
import { parseSalesRows, readSalesRows, validateSalesSheet } from '@/lib/relationships/sales-import';

// 欄位驗證與日期規則已抽到 lib/relationships/sales-import.ts（與 workspace 匯入共用）；此 route 的行為不變：每次匯入都新建批次並直接 insert，不去重。
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const permission = await requirePermission(user.id, 'relationship_member.edit');
  if (!permission.allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '請選擇 .xlsx 檔案' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: '僅支援 .xlsx 格式' }, { status: 400 });
  }

  const rows = readSalesRows(Buffer.from(await file.arrayBuffer()));
  if (!rows) return NextResponse.json({ error: 'Excel 檔案無法解析' }, { status: 400 });

  const sheetError = validateSalesSheet(rows);
  if (sheetError) return NextResponse.json({ error: sheetError }, { status: 400 });

  const { validRows, errors } = parseSalesRows(rows);
  if (errors.length) {
    return NextResponse.json({ error: errors.slice(0, 10).join('\n'), error_count: errors.length }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: importBatch, error: batchError } = await admin
    .from('relationship_sales_imports')
    .insert({ file_name: file.name, row_count: validRows.length, imported_by: user.id })
    .select('id')
    .single();
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 });

  const payload = validRows.map((row) => ({
    import_id: importBatch.id,
    store_code: row.storeCode,
    sale_datetime: row.saleDatetime,
    member_number: row.memberNumber,
    product_code: row.productCode,
    product_name: row.productName,
    quantity: row.quantity,
    amount: row.amount,
    imported_by: user.id,
  }));

  for (let start = 0; start < payload.length; start += 500) {
    const { error } = await admin.from('relationship_sales_details').insert(payload.slice(start, start + 500));
    if (error) {
      await admin.from('relationship_sales_imports').delete().eq('id', importBatch.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, imported: payload.length });
}
