import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveWorkspacePublicRedirect } from '@/lib/workspace/public-routes';

export async function middleware(request: NextRequest) {
  // For now, let's disable middleware to allow all routes
  // We'll handle authentication checks in the page components themselves
  const isDevWorkspace =
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://mjpdfpxqttbhzeimmtqr.supabase.co';
  // D14：公開頁保留 Next 原路徑，轉址到 Vue 工作台 hash 路由（目前僅示範路由，僅 DEV 工作台環境）。
  if (isDevWorkspace) {
    const target = resolveWorkspacePublicRedirect(request.nextUrl.pathname);
    if (target) return NextResponse.redirect(new URL(target, request.url), 307);
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
