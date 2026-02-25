import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getCurrentUser } from '@/app/auth/actions';
import Navbar from '@/components/Navbar';
import PWARegister from '@/components/PWARegister';
import { Suspense } from 'react';
import AuthCodeHandler from '@/components/AuthCodeHandler';

export const metadata: Metadata = {
  title: 'FK菁英業務管理',
  description: '富康藥局菁英業務管理系統',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '富康菁英',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getCurrentUser();

  return (
    <html lang="zh-TW">
      <body>
        {/* PWA Service Worker 註冊 */}
        <PWARegister />
        {/* 處理 Supabase 認證 code 參數 */}
        <Suspense fallback={null}>
          <AuthCodeHandler />
        </Suspense>
        
        {user && <Navbar user={{
          id: user.id,
          email: user.email,
          profile: user.profile,
        } as any} />}
        {children}
      </body>
    </html>
  );
}
