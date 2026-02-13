import type { Metadata } from 'next';
import './globals.css';
import { getCurrentUser } from '@/app/auth/actions';
import Navbar from '@/components/Navbar';
import { Suspense } from 'react';
import AuthCodeHandler from '@/components/AuthCodeHandler';

export const metadata: Metadata = {
  title: '富康內部業務管理系統',
  description: '專為富康藥局打造的內部業務管理與協作系統',
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
