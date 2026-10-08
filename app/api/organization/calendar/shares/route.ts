import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { readCalendarRequestBody } from '@/lib/admin/organization-calendar';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const eventId = request.nextUrl.searchParams.get('event_id')?.trim();
    if (!eventId) return NextResponse.json({ error: '缺少行事 ID' }, { status: 400 });

    const [eventResult, shareResult] = await Promise.all([
      supabase.from('organization_personal_calendar_events').select('id, owner_id').eq('id', eventId).single(),
      supabase
        .from('organization_personal_calendar_event_shares')
        .select('id, event_id, parent_share_id, shared_by_user_id, shared_with_user_id, created_at, revoked_at, revoked_by')
        .eq('event_id', eventId)
        .order('created_at'),
    ]);

    if (eventResult.error) throw eventResult.error;
    if (shareResult.error) throw shareResult.error;

    const shares = shareResult.data || [];
    const profileIds = Array.from(new Set([
      eventResult.data.owner_id,
      ...shares.flatMap((share: any) => [share.shared_by_user_id, share.shared_with_user_id]),
    ].filter(Boolean)));
    const admin = createAdminClient();
    const profileResult = profileIds.length
      ? await admin.from('profiles').select('id, full_name, employee_code').in('id', profileIds)
      : { data: [], error: null } as any;
    if (profileResult.error) throw profileResult.error;
    const people = Object.fromEntries((profileResult.data || []).map((profile: any) => [profile.id, {
      name: profile.full_name || '未設定姓名',
      employee_code: profile.employee_code || null,
    }]));

    const byId = new Map(shares.map((share: any) => [share.id, share]));
    const getEffective = (share: any) => {
      const seen = new Set<string>();
      let current = share;
      while (current) {
        if (current.revoked_at || seen.has(current.id)) return false;
        seen.add(current.id);
        if (!current.parent_share_id) return current.shared_by_user_id === eventResult.data.owner_id;
        current = byId.get(current.parent_share_id);
        if (!current) return false;
      }
      return false;
    };

    return NextResponse.json({
      shares: shares.map((share: any) => ({ ...share, is_effective: getEffective(share) })),
      isOwner: eventResult.data.owner_id === user.id,
      currentUserId: user.id,
      owner: people[eventResult.data.owner_id] || null,
      people,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('取得行事分享設定失敗:', error);
    return NextResponse.json({ error: error.message || '取得行事分享設定失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const body = await readCalendarRequestBody(request);
    if (!body) return NextResponse.json({ error: '請提供有效的分享資料' }, { status: 400 });
    const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
    const recipientId = typeof body.shared_with_user_id === 'string' ? body.shared_with_user_id.trim() : '';
    const parentShareId = typeof body.parent_share_id === 'string' ? body.parent_share_id.trim() : null;
    if (!eventId || !recipientId) return NextResponse.json({ error: '請選擇分享對象' }, { status: 400 });

    const { data, error } = await supabase.rpc('organization_calendar_share_personal_event', {
      p_event_id: eventId,
      p_shared_with_user_id: recipientId,
      p_parent_share_id: parentShareId,
    });
    if (error) throw error;
    return NextResponse.json({ share_id: data }, { status: 201 });
  } catch (error: any) {
    console.error('分享個人行事失敗:', error);
    return NextResponse.json({ error: error.message || '分享個人行事失敗' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const shareId = request.nextUrl.searchParams.get('id')?.trim();
    if (!shareId) return NextResponse.json({ error: '缺少分享 ID' }, { status: 400 });
    const { data, error } = await supabase.rpc('organization_calendar_revoke_personal_event_share', {
      p_share_id: shareId,
    });
    if (error) throw error;
    if (!data) return NextResponse.json({ error: '分享紀錄不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('撤回行事分享失敗:', error);
    return NextResponse.json({ error: error.message || '撤回行事分享失敗' }, { status: 500 });
  }
}
