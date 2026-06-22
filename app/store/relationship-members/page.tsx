import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission, hasPermission } from '@/lib/permissions/check';
import RelationshipMembersClient from './RelationshipMembersClient';

export const dynamic = 'force-dynamic';

export default async function RelationshipMembersPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const canView = await hasAnyPermission(user.id, [
    'relationship_member.view',
    'relationship_member.edit',
    'relationship_member.delete',
    'relationship_member.approve',
  ]);
  if (!canView) redirect('/');

  const hasViewPermission = await hasPermission(user.id, 'relationship_member.view');
  const canEdit = await hasPermission(user.id, 'relationship_member.edit');
  const canDelete = await hasPermission(user.id, 'relationship_member.delete');
  const canApprove = await hasPermission(user.id, 'relationship_member.approve');
  return (
    <RelationshipMembersClient
      canSubmit={hasViewPermission || canEdit}
      canViewSales={hasViewPermission || canEdit}
      canEdit={canEdit}
      canDelete={canDelete}
      canApprove={canApprove}
    />
  );
}
