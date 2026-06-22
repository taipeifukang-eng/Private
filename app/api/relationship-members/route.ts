import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

async function getUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const allowed = await hasAnyPermission(user.id, [
    'relationship_member.view',
    'relationship_member.edit',
    'relationship_member.delete',
    'relationship_member.approve',
  ]);
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('relationship_members')
    .select('id, member_name, phone, relationship, member_number, is_approved, approved_at, approved_by, created_by, created_at, updated_at, creator:profiles!relationship_members_created_by_fkey(full_name, email), approver:profiles!relationship_members_approved_by_fkey(full_name, email)')
    .order('member_number', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = [...(data || [])].sort((a, b) => {
    const aMemberNumber = String(a.member_number || '').trim();
    const bMemberNumber = String(b.member_number || '').trim();

    if (!aMemberNumber && bMemberNumber) return -1;
    if (aMemberNumber && !bMemberNumber) return 1;
    if (!aMemberNumber && !bMemberNumber) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }

    return aMemberNumber.localeCompare(bMemberNumber, 'zh-Hant', {
      numeric: true,
      sensitivity: 'base',
    });
  });

  return NextResponse.json({ members });
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const allowed = await hasAnyPermission(user.id, [
    'relationship_member.view',
    'relationship_member.edit',
  ]);
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const body = await request.json();
  const memberName = String(body.member_name || '').trim();
  const phone = String(body.phone || '').trim();
  const relationship = String(body.relationship || '').trim();
  if (!memberName || !phone || !relationship) {
    return NextResponse.json({ error: '姓名、電話與關係皆為必填' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('relationship_members')
    .insert({ member_name: memberName, phone, relationship, created_by: user.id })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id }, { status: 201 });
}
