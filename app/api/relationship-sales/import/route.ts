import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

type SalesRow = Record<string, unknown>;
const REQUIRED_HEADERS = ['門市代號', '銷售日期', '會員編號', '品號', '品名', '數量', '金額'];

function textValue(value: unknown) {
  return String(value ?? '').trim();
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return value;
  const normalized = textValue(value).replace(/,/g, '');
  return normalized === '' ? Number.NaN : Number(normalized);
}

function saleDateValue(value: unknown): string | null {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}T${String(parsed.H).padStart(2, '0')}:${String(parsed.M).padStart(2, '0')}:00+08:00`;
  }

  const match = textValue(value).match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const candidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
  if (Number.isNaN(candidate.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
  if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour !== hour || parts.minute !== minute) return null;
  return `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
}

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

  let rows: SalesRow[];
  try {
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<SalesRow>(sheet, { defval: '' });
  } catch {
    return NextResponse.json({ error: 'Excel 檔案無法解析' }, { status: 400 });
  }

  if (!rows.length) return NextResponse.json({ error: 'Excel 中沒有資料' }, { status: 400 });
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !(header in rows[0]));
  if (missingHeaders.length) {
    return NextResponse.json({ error: `缺少欄位：${missingHeaders.join('、')}` }, { status: 400 });
  }
  const actualHeaders = Object.keys(rows[0]).slice(0, REQUIRED_HEADERS.length);
  const hasCorrectOrder = REQUIRED_HEADERS.every((header, index) => actualHeaders[index] === header);
  if (!hasCorrectOrder) {
    return NextResponse.json({
      error: `欄位順序錯誤，前七欄必須依序為：${REQUIRED_HEADERS.join('、')}`,
    }, { status: 400 });
  }

  const errors: string[] = [];
  const validRows = rows.map((row, index) => {
    const storeCode = textValue(row['門市代號']);
    const saleDatetime = saleDateValue(row['銷售日期']);
    const memberNumber = textValue(row['會員編號']);
    const productCode = textValue(row['品號']);
    const productName = textValue(row['品名']);
    const quantity = numberValue(row['數量']);
    const amount = numberValue(row['金額']);
    if (!storeCode || !saleDatetime || !memberNumber || !productCode || !productName || !Number.isFinite(quantity) || !Number.isFinite(amount)) {
      errors.push(`第 ${index + 2} 列資料不完整，銷售日期須為 YYYY/MM/DD HH:MM，數量與金額須為數字`);
    }
    return { storeCode, saleDatetime, memberNumber, productCode, productName, quantity, amount };
  });

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
