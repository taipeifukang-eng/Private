import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const permission = await requirePermission(user.id, 'relationship_member.approve');
  if (!permission.allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const reason = String(body.rejection_reason || '').trim();
  if (!reason) {
    return NextResponse.json({ error: '請填寫駁回原因' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('relationship_members')
    .update({
      is_approved: false,
      approved_at: null,
      approved_by: null,
      rejected_at: new Date().toISOString(),
      rejected_by: user.id,
      rejection_reason: reason,
      updated_by: user.id,
    })
    .eq('id', params.id)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '找不到關係會員資料' }, { status: 404 });

  return NextResponse.json({ success: true });
}
