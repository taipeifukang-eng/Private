import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const STORE_MANAGER_ASSIGN_PERMISSION_CODES = [
  'store.manager.assign',
  'store.manage',
] as const;

export const STORE_SUPERVISOR_ASSIGN_PERMISSION_CODES = [
  'store.supervisor.assign',
  'store.manage',
] as const;

export const STORE_SCOPE_MANAGEMENT_PERMISSION_CODES = [
  ...STORE_MANAGER_ASSIGN_PERMISSION_CODES,
  ...STORE_SUPERVISOR_ASSIGN_PERMISSION_CODES,
] as const;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function requireAuthenticatedUser(supabase: SupabaseServerClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      response: Response.json({ success: false, error: '未登入' }, { status: 401 }),
    };
  }

  return { user, response: null };
}

export async function userCanManageStoreManagers(userId: string) {
  return hasAnyPermission(userId, STORE_MANAGER_ASSIGN_PERMISSION_CODES);
}

export async function userCanManageSupervisors(userId: string) {
  return hasAnyPermission(userId, STORE_SUPERVISOR_ASSIGN_PERMISSION_CODES);
}

export async function userCanReadStoreScopeManagement(userId: string) {
  return hasAnyPermission(userId, STORE_SCOPE_MANAGEMENT_PERMISSION_CODES);
}

export async function requireStoreScopePermission(
  userId: string,
  permissionCodes: readonly string[],
) {
  const allowed = await hasAnyPermission(userId, permissionCodes);

  if (!allowed) {
    return Response.json(
      {
        success: false,
        error: `權限不足：需要 ${permissionCodes.join(' 或 ')} 權限`,
      },
      { status: 403 },
    );
  }

  return null;
}
