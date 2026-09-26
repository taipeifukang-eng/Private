import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageUtilityBills, canViewUtilityBills } from '@/lib/general-affairs/utility-bills/access';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['WATER', 'ELECTRICITY', 'PHONE', 'INTERNET']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error || '操作失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

function text(value: unknown, max = 200) {
  return String(value || '').trim().slice(0, max) || null;
}

function payloadOf(body: Record<string, unknown>) {
  const expenseType = String(body.expense_type || '').toUpperCase();
  if (!TYPES.has(expenseType)) throw new Error('請選擇費用類型');
  const billingMonth = String(body.billing_month || '');
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) throw new Error('請選擇帳單月份');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('請輸入正確金額');
  const electricityKwh = body.electricity_kwh === '' || body.electricity_kwh === null || body.electricity_kwh === undefined
    ? null
    : Number(body.electricity_kwh);
  if (electricityKwh !== null && (!Number.isFinite(electricityKwh) || electricityKwh < 0)) throw new Error('請輸入正確用電度數');
  const locationName = text(body.location_name, 120);
  if (!locationName) throw new Error('請選擇或輸入據點');
  const storeId = text(body.store_id, 36);
  if (storeId && !uuid.test(storeId)) throw new Error('據點格式錯誤');
  const serviceIdentifier = text(body.service_identifier);
  const equipmentSerial = expenseType === 'INTERNET' ? text(body.equipment_serial) : null;
  if (expenseType === 'INTERNET' && !serviceIdentifier && !equipmentSerial) throw new Error('網路費請至少填寫電路編號或設備序號');
  if (expenseType !== 'INTERNET' && !serviceIdentifier) throw new Error('請填寫服務識別號碼');
  return {
    store_id: storeId,
    location_name: locationName,
    expense_type: expenseType,
    billing_month: `${billingMonth}-01`,
    provider_name: text(body.provider_name),
    service_label: text(body.service_label),
    service_identifier: serviceIdentifier,
    account_number: text(body.account_number),
    equipment_serial: equipmentSerial,
    amount,
    electricity_kwh: expenseType === 'ELECTRICITY' ? electricityKwh : null,
    due_date: text(body.due_date, 10),
    paid_at: text(body.paid_at, 10),
    reference_no: text(body.reference_no),
    notes: text(body.notes, 1000),
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('未登入', 401);
    if (!await canViewUtilityBills()) return fail('沒有費用紀錄查看權限', 403);
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const type = searchParams.get('type');
    const storeId = searchParams.get('storeId');
    let query = supabase.from('ga_utility_bills').select('*, store:stores(id, store_code, store_name, short_name)').is('deleted_at', null);
    if (month && /^\d{4}-\d{2}$/.test(month)) query = query.eq('billing_month', `${month}-01`);
    if (type && TYPES.has(type)) query = query.eq('expense_type', type);
    if (storeId && uuid.test(storeId)) query = query.eq('store_id', storeId);
    const [{ data, error }, storesResult, canManage] = await Promise.all([
      query.order('billing_month', { ascending: false }).order('due_date', { ascending: true }).limit(500),
      supabase.from('stores').select('id, store_code, store_name, short_name').eq('is_active', true).order('store_code'),
      canManageUtilityBills(),
    ]);
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [], meta: { stores: storesResult.data || [], canManage } });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('未登入', 401);
    if (!await canManageUtilityBills()) return fail('沒有費用紀錄管理權限', 403);
    const payload = payloadOf(await request.json());
    const { data, error } = await supabase.from('ga_utility_bills').insert(payload).select('*, store:stores(id, store_code, store_name, short_name)').single();
    if (error) throw error;
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
