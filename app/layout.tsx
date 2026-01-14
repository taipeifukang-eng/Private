import type { Metadata } from 'next';
import './globals.css';
import { getCurrentUser } from '@/app/auth/actions';
import Navbar from '@/components/Navbar';

export const metadata: Metadata = {
  title: '動態工作流程與檢查清單系統',
  description: '專為富康程式開發打造的流程審核系統',
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
