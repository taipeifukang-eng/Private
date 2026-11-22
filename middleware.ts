import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveWorkspacePublicRedirect } from '@/lib/workspace/public-routes';
import { activityLegacyTarget } from '@/lib/workspace/activity-view-rules';
import { calendarLegacyTarget } from '@/lib/workspace/calendar-rules';

export async function middleware(request: NextRequest) {
  // For now, let's disable middleware to allow all routes
  // We'll handle authentication checks in the page components themselves
  const isDevWorkspace =
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://mjpdfpxqttbhzeimmtqr.supabase.co';
  // D14：公開頁保留 Next 原路徑，轉址到 Vue 工作台 hash 路由（目前僅示範路由，僅 DEV 工作台環境）。
  if (isDevWorkspace) {
    const target = resolveWorkspacePublicRedirect(request.nextUrl.pathname, undefined, request.nextUrl.search);
    if (target) return NextResponse.redirect(new URL(target, request.url), 307);
    // M5 W20 Q8：舊網址 /activity-management、/activity-view/:id 自動轉到新版活動檢視（舊頁與舊 API 不動，僅 DEV 工作台環境啟用）。
    const activityTarget = activityLegacyTarget(request.nextUrl.pathname, request.nextUrl.search);
    if (activityTarget) return NextResponse.redirect(new URL(activityTarget, request.url), 307);
    // M5 W23／W24：/organization/calendar（含 Google 授權回調帶來的 google_calendar／google_detail）轉到新版年度行事曆；回調網址本身（/api/organization/calendar/google/callback）不變。
    const calendarTarget = calendarLegacyTarget(request.nextUrl.pathname, request.nextUrl.search);
    if (calendarTarget) return NextResponse.redirect(new URL(calendarTarget, request.url), 307);
  }
  const response = NextResponse.next();
  // The DEV workspace entry must pick up the current hashed bundle after a rebuild.
  if (
    isDevWorkspace &&
    ['/workspace', '/workspace/', '/workspace/index.html'].includes(request.nextUrl.pathname)
  ) {
    response.headers.set('Cache-Control', 'no-store, max-age=0');
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
