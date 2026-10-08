import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import {
  cleanCalendarText,
  isCalendarDate,
  ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION,
  ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION,
  ORGANIZATION_CALENDAR_EVENT_TYPES,
  readCalendarRequestBody,
} from '@/lib/admin/organization-calendar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
    const eventId = request.nextUrl.searchParams.get('event_id')?.trim();
    if (!eventId) return NextResponse.json({ error: '缺少行事 ID' }, { status: 400 });

    const [eventResult, auditResult] = await Promise.all([
      supabase.from('organization_calendar_events').select('id, title').eq('id', eventId).maybeSingle(),
      supabase
        .from('organization_calendar_event_audit')
        .select('id, action, actor_name, changed_at, before_data, after_data')
        .eq('event_id', eventId)
        .order('changed_at', { ascending: false }),
    ]);
    if (eventResult.error) throw eventResult.error;
    if (auditResult.error) throw auditResult.error;
    if (!eventResult.data) return NextResponse.json({ error: '找不到這筆公司行事' }, { status: 404 });
    return NextResponse.json({ event: eventResult.data, history: auditResult.data || [] }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('取得公司行事異動紀錄失敗:', error);
    return NextResponse.json({ error: error.message || '取得異動紀錄失敗' }, { status: 500 });
  }
}

function validateEvent(body: Record<string, unknown>) {
  const title = cleanCalendarText(body.title, 160);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const eventType = body.event_type;
  const startDate = body.start_date;
  const endDate = body.end_date;
  if (!title) return { error: '請輸入行事名稱（最多 160 字）' };
  if (typeof eventType !== 'string' || !ORGANIZATION_CALENDAR_EVENT_TYPES.includes(eventType as typeof ORGANIZATION_CALENDAR_EVENT_TYPES[number])) {
    return { error: '行事類型無效' };
  }
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) {
    return { error: '請確認行事日期範圍' };
  }
  if (description.length > 3000) return { error: '補充說明最多 3000 字' };
  return {
    value: {
      title,
      event_type: eventType as typeof ORGANIZATION_CALENDAR_EVENT_TYPES[number],
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
    if (!(await hasPermission(user.id, ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION))) {
      return NextResponse.json({ error: '沒有新增公司行事的權限' }, { status: 403 });
    }

    const body = await readCalendarRequestBody(request);
    if (!body) return NextResponse.json({ error: '請提供有效的行事資料' }, { status: 400 });
    const validated = validateEvent(body);
    if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 });

    const { data, error } = await supabase
      .from('organization_calendar_events')
      .insert(validated.value)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ event: data }, { status: 201 });
  } catch (error: any) {
    console.error('新增公司行事失敗:', error);
    return NextResponse.json({ error: error.message || '新增公司行事失敗' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user } = await currentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
    if (!(await hasPermission(user.id, ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION))) {
      return NextResponse.json({ error: '沒有修改公司行事的權限' }, { status: 403 });
    }

    const body = await readCalendarRequestBody(request);
    if (!body) return NextResponse.json({ error: '請提供有效的行事資料' }, { status: 400 });
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: '缺少行事 ID' }, { status: 400 });

    const isCancel = body.status === 'cancelled';
    let update: Record<string, unknown>;
    if (isCancel) {
      update = { status: 'cancelled' };
    } else {
      const validated = validateEvent(body);
      if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 });
      update = validated.value;
    }

    const { data, error } = await supabase
      .from('organization_calendar_events')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ event: data });
  } catch (error: any) {
    console.error('更新公司行事失敗:', error);
    return NextResponse.json({ error: error.message || '更新公司行事失敗' }, { status: 500 });
  }
}
