// ============================================
// 角色編輯頁面
// ============================================

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';
import RoleEditClient from './RoleEditClient';

export const metadata = {
  title: '編輯角色 | 流程審核系統'
};

export default async function RoleEditPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 檢查權限
  const canView = await hasPermission(user.id, 'role.role.view');
  const canEdit = await hasPermission(user.id, 'role.role.edit');
  const canAssignPermissions = await hasPermission(user.id, 'role.permission.assign');

  if (!canView) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Suspense fallback={
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        }>
          <RoleEditClient 
            roleId={params.id}
            canEdit={canEdit}
            canAssignPermissions={canAssignPermissions}
          />
        </Suspense>
      </div>
    </div>
  );
}
