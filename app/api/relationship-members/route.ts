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
    .select('id, member_name, phone, relationship, member_number, is_approved, approved_at, approved_by, created_by, created_at, updated_at')
    .order('member_number', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileIds = Array.from(new Set(
    (data || [])
      .flatMap((member) => [member.created_by, member.approved_by])
      .filter((id): id is string => Boolean(id))
  ));
  const { data: profiles, error: profilesError } = profileIds.length > 0
    ? await admin
      .from('profiles')
      .select('id, full_name, email')
      .in('id', profileIds)
    : { data: [], error: null };

  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const membersWithProfiles = (data || []).map((member) => ({
    ...member,
    creator: member.created_by ? profileById.get(member.created_by) || null : null,
    approver: member.approved_by ? profileById.get(member.approved_by) || null : null,
  }));

  const members = membersWithProfiles.sort((a, b) => {
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
