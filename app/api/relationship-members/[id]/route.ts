import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const permission = await requirePermission(user.id, 'relationship_member.edit');
  if (!permission.allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const body = await request.json();
  const memberName = String(body.member_name || '').trim();
  const phone = String(body.phone || '').trim();
  const relationship = String(body.relationship || '').trim();
  const memberNumber = String(body.member_number || '').trim() || null;
  if (!memberName || !phone || !relationship) {
    return NextResponse.json({ error: '姓名、電話與關係皆為必填' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('relationship_members')
    .update({
      member_name: memberName,
      phone,
      relationship,
      member_number: memberNumber,
      updated_by: user.id,
    })
    .eq('id', params.id);

  if (error?.code === '23505') {
    return NextResponse.json({ error: '此會員編號已被其他關係會員使用' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const permission = await requirePermission(user.id, 'relationship_member.delete');
  if (!permission.allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('relationship_members')
    .delete()
    .eq('id', params.id)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '找不到關係會員資料' }, { status: 404 });
  return NextResponse.json({ success: true });
}
