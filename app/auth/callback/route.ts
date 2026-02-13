import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/reset-password';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
      console.error('Exchange code error:', error);
      // 如果交換失敗，重定向到錯誤頁面
      return NextResponse.redirect(
        new URL(`/reset-password?error=${encodeURIComponent(error.message)}`, requestUrl.origin)
      );
    }

    // 成功後重定向到重置密碼頁面
    return NextResponse.redirect(new URL(next, requestUrl.origin));
  }

  // 如果沒有 code，重定向到登入頁面
  return NextResponse.redirect(new URL('/login', requestUrl.origin));
}
