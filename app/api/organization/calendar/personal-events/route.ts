import { NextRequest, NextResponse } from 'next/server';
import { cleanCalendarText, isCalendarDate, readCalendarRequestBody } from '@/lib/admin/organization-calendar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function validatePersonalEvent(body: Record<string, unknown>) {
  const title = cleanCalendarText(body.title, 160);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const startDate = body.start_date;
  const endDate = body.end_date;
  if (!title) return { error: '請輸入行事名稱（最多 160 字）' };
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) {
    return { error: '請確認行事日期範圍' };
  }
  if (description.length > 3000) return { error: '補充說明最多 3000 字' };
  return {
    value: {
      title,
      start_date: startDate,
      end_date: endDate,
      description: description || null,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const body = await readCalendarRequestBody(request);
    if (!body) return NextResponse.json({ error: '請提供有效的行事資料' }, { status: 400 });
    const validated = validatePersonalEvent(body);
    if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 });

    const { data, error } = await supabase
      .from('organization_personal_calendar_events')
      .insert({ ...validated.value, owner_id: user.id })
      .select('*')
      .single();
    if (error) throw error;

    const recipientIds = Array.isArray(body.share_with_user_ids)
      ? Array.from(new Set(body.share_with_user_ids.filter((id: unknown) => typeof id === 'string' && id !== user.id)))
      : [];

    for (const recipientId of recipientIds) {
      const { error: shareError } = await supabase.rpc('organization_calendar_share_personal_event', {
        p_event_id: data.id,
        p_shared_with_user_id: recipientId,
        p_parent_share_id: null,
      });
      if (shareError) {
        await supabase.from('organization_personal_calendar_events').delete().eq('id', data.id);
        throw shareError;
      }
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (error: any) {
    console.error('新增個人行事失敗:', error);
    return NextResponse.json({ error: error.message || '新增個人行事失敗' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const body = await readCalendarRequestBody(request);
    if (!body) return NextResponse.json({ error: '請提供有效的行事資料' }, { status: 400 });
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: '缺少行事 ID' }, { status: 400 });
    const validated = validatePersonalEvent(body);
    if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 });

    const { data, error } = await supabase
      .from('organization_personal_calendar_events')
      .update(validated.value)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ event: data });
  } catch (error: any) {
    console.error('更新個人行事失敗:', error);
    return NextResponse.json({ error: error.message || '更新個人行事失敗' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const id = request.nextUrl.searchParams.get('id')?.trim();
    if (!id) return NextResponse.json({ error: '缺少行事 ID' }, { status: 400 });
    const { error } = await supabase
      .from('organization_personal_calendar_events')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('刪除個人行事失敗:', error);
    return NextResponse.json({ error: error.message || '刪除個人行事失敗' }, { status: 500 });
  }
}
