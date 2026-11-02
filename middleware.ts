import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // For now, let's disable middleware to allow all routes
  // We'll handle authentication checks in the page components themselves
  const response = NextResponse.next();
  // The DEV workspace entry must pick up the current hashed bundle after a rebuild.
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://mjpdfpxqttbhzeimmtqr.supabase.co' &&
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
