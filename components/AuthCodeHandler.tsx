'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * 處理 Supabase 認證回調 code 參數
 * 如果 URL 中有 code 參數，自動跳轉到 /auth/callback
 */
export default function AuthCodeHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    
    // 如果有 code 參數，跳轉到 auth callback
    if (code) {
      console.log('Detected auth code, redirecting to callback...');
      router.push(`/auth/callback?code=${code}&next=/reset-password`);
    }
  }, [searchParams, router]);

  // 這個組件不渲染任何內容
  return null;
}
