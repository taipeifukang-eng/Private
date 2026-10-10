import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION } from '@/lib/admin/organization-calendar';
import {
  encryptRefreshToken,
  getGoogleCalendarEnvironment,
  isGoogleCalendarConfigured,
  syncCompanyCalendarSnapshot,
} from '@/lib/organization/google-calendar';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function calendarPage(request: NextRequest, result: string, detail?: string) {
  const origin = getGoogleCalendarEnvironment().redirectUri
    ? new URL(getGoogleCalendarEnvironment().redirectUri).origin
    : request.nextUrl.origin;
  const url = new URL('/organization/calendar', origin);
  url.searchParams.set('google_calendar', result);
  if (detail) url.searchParams.set('google_detail', detail.slice(0, 300));
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || '';
  const expected = request.cookies.get('organization_calendar_google_oauth_state')?.value || '';
  const cookieResponse = (response: NextResponse) => {
    response.cookies.set('organization_calendar_google_oauth_state', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/organization/calendar/google',
      maxAge: 0,
    });
    return response;
  };
  if (!state || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return cookieResponse(calendarPage(request, 'error', 'Google 授權驗證逾時或失敗，請重新連結'));
  }

  try {
    const googleError = request.nextUrl.searchParams.get('error');
    if (googleError) return cookieResponse(calendarPage(request, 'error', '已取消 Google 授權'));
    const code = request.nextUrl.searchParams.get('code');
    if (!code || !isGoogleCalendarConfigured()) {
      return cookieResponse(calendarPage(request, 'error', 'Google OAuth 伺服器設定不完整'));
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return cookieResponse(calendarPage(request, 'error', '登入狀態已失效，請重新登入後連結'));
    if (!(await hasPermission(user.id, ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION))) {
      return cookieResponse(calendarPage(request, 'error', '目前帳號沒有管理 Google 同步的權限'));
    }

    const config = getGoogleCalendarEnvironment();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenPayload.access_token !== 'string') {
      throw new Error('Google 授權交換失敗，請確認 OAuth 用戶端與回呼網址設定');
    }

    const admin = createAdminClient();
    const { data: existing, error: existingError } = await admin
      .from('organization_calendar_google_connections')
      .select('calendar_id, refresh_token_ciphertext')
      .eq('id', 1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.calendar_id && existing.calendar_id !== config.calendarId) {
      throw new Error('已連結的 Google 日曆 ID 與伺服器設定不同，請先確認 GOOGLE_CALENDAR_ID');
    }

    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
      cache: 'no-store',
    });
    const userInfo = await userInfoResponse.json().catch(() => ({}));
    if (!userInfoResponse.ok || typeof userInfo.email !== 'string') {
      throw new Error('無法確認 Google 授權帳號');
    }
    const refreshToken = typeof tokenPayload.refresh_token === 'string'
      ? tokenPayload.refresh_token
      : null;
    if (!refreshToken && !existing?.refresh_token_ciphertext) {
      throw new Error('Google 沒有回傳更新授權，請重新連結並允許離線存取');
    }

    const { error: saveError } = await admin.from('organization_calendar_google_connections').upsert({
      id: 1,
      calendar_id: config.calendarId,
      google_account_email: userInfo.email,
      refresh_token_ciphertext: refreshToken ? encryptRefreshToken(refreshToken) : existing?.refresh_token_ciphertext || '',
      connected_by: user.id,
      connected_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (saveError) throw saveError;

    const sync = await syncCompanyCalendarSnapshot();
    const result = sync.status === 'failed' || sync.status === 'partial' ? 'connected_with_errors' : 'connected';
    const message = sync.failed
      ? `已連結；${sync.synced || 0} 筆完成，${sync.failed} 筆待重試`
      : `已連結並同步 ${sync.synced || 0} 筆公司行事與假日`;
    return cookieResponse(calendarPage(request, result, message));
  } catch (error: any) {
    console.error('Google 行事曆 OAuth 回呼失敗:', error);
    return cookieResponse(calendarPage(request, 'error', error.message || 'Google 連結失敗'));
  }
}
