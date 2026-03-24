import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

// POST - 督導拒絕調店申請
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = profile?.role === 'admin';
    const canConfirm = await hasPermission(user.id, 'employee.store_transfer.confirm');

    if (!isAdmin && !canConfirm) {
      return NextResponse.json({ success: false, error: '只有督導可以拒絕調店申請' }, { status: 403 });
    }

    const { data: req, error: fetchError } = await supabase
      .from('store_transfer_requests')
      .select('status')
      .eq('id', params.id)
      .single();

    if (fetchError || !req) {
      return NextResponse.json({ success: false, error: '找不到此申請記錄' }, { status: 404 });
    }

    if (req.status !== 'pending') {
      return NextResponse.json({ success: false, error: '此申請已被處理' }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from('store_transfer_requests')
      .update({
        status: 'rejected',
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: '已拒絕此調店申請' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
