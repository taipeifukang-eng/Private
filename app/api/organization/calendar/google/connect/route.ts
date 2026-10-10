import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION } from '@/lib/admin/organization-calendar';
import { getGoogleCalendarEnvironment, isGoogleCalendarConfigured } from '@/lib/organization/google-calendar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
    if (!(await hasPermission(user.id, ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION))) {
      return NextResponse.json({ error: '沒有管理 Google 行事曆同步的權限' }, { status: 403 });
    }
    if (!isGoogleCalendarConfigured()) {
      return NextResponse.json({ error: '伺服器尚未設定 Google OAuth、日曆 ID 與加密金鑰' }, { status: 503 });
    }

    const config = getGoogleCalendarEnvironment();
    const state = randomBytes(32).toString('base64url');
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent select_account',
      include_granted_scopes: 'true',
      scope: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.events.owned',
      ].join(' '),
      state,
    }).toString();

    const response = NextResponse.redirect(authorization);
    response.cookies.set('organization_calendar_google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/organization/calendar/google',
      maxAge: 600,
    });
    return response;
  } catch (error: any) {
    console.error('開始 Google 行事曆連結失敗:', error);
    return NextResponse.json({ error: error.message || '無法開始 Google 連結' }, { status: 500 });
  }
}
