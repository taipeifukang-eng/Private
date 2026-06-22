import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const permission = await requirePermission(user.id, 'relationship_member.approve');
  if (!permission.allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('relationship_members')
    .update({
      is_approved: true,
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      updated_by: user.id,
    })
    .eq('id', params.id)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '找不到關係會員資料' }, { status: 404 });

  return NextResponse.json({ success: true });
}
