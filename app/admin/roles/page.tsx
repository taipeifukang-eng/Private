// ============================================
// 角色管理列表頁面
// ============================================

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';
import RoleListClient from './RoleListClient';

export const metadata = {
  title: '角色管理 | 流程審核系統',
  description: '管理系統角色與權限'
};

export default async function RolesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 檢查權限
  const canView = await hasPermission(user.id, 'role.role.view');
  if (!canView) {
    redirect('/dashboard');
  }

  // 檢查是否可以建立角色
  const canCreate = await hasPermission(user.id, 'role.role.create');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">角色管理</h1>
          <p className="mt-2 text-gray-600">
            管理系統角色及其權限設定
          </p>
        </div>

        <Suspense fallback={
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        }>
          <RoleListClient canCreate={canCreate} />
        </Suspense>
      </div>
    </div>
  );
}
