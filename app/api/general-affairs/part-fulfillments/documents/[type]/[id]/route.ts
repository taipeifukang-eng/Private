import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canReadPartFulfillments } from '@/lib/general-affairs/part-fulfillments/access';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: { type: string; id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    if (!await canReadPartFulfillments()) return NextResponse.json({ success: false, error: '沒有單據查看權限' }, { status: 403 });

    const type = params.type.toUpperCase();
    let query;
    if (type === 'STOCK_ISSUE') {
      query = supabase.from('ga_inventory_transactions').select(`id, transaction_no, transaction_type, quantity_input, input_unit_type, quantity_base, balance_before, balance_after, reason, notes, occurred_at, created_at, location:ga_inventory_locations(id, code, name), part:ga_parts(id, part_code, name, base_unit, purchase_unit)`).eq('id', params.id);
    } else if (type === 'TRANSFER') {
      query = supabase.from('ga_inventory_transfers').select(`id, transfer_no, status, reason, notes, shipping_method, source_confirmed_at, shipped_at, received_at, canceled_at, cancel_reason, created_at, source_location:ga_inventory_locations!ga_inventory_transfers_source_location_id_fkey(id, code, name), destination_location:ga_inventory_locations!ga_inventory_transfers_destination_location_id_fkey(id, code, name), items:ga_inventory_transfer_items(id, quantity_input, input_unit_type, part:ga_parts(id, part_code, name, base_unit, purchase_unit))`).eq('id', params.id);
    } else if (type === 'PURCHASE') {
      query = supabase.from('ga_purchase_reviews').select(`id, purchase_no, decision, vendor_name, approved_quantity, approved_unit, estimated_amount, quoted_amount, negotiated_amount, final_amount, expected_delivery_date, delivery_method, decision_note, public_note, created_at, updated_at, vendor:ga_vendors(id, name, alias), receiving_location:ga_inventory_locations(id, code, name)`).eq('id', params.id);
    } else {
      return NextResponse.json({ success: false, error: '不支援的單據類型' }, { status: 400 });
    }
    const { data, error } = await query.single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '單據載入失敗' }, { status: 500 });
  }
}
