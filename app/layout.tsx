import type { Metadata } from 'next';
import './globals.css';
import { getCurrentUser } from '@/app/auth/actions';
import Navbar from '@/components/Navbar';

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
        {user && <Navbar user={user as any} />}
        {children}
      </body>
    </html>
  );
}
