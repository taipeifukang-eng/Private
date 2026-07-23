const ADMIN_LIKE_ROLE_CODES = new Set([
  'admin',
  'system_admin',
  'admin_role',
  'full_admin',
  'full_admin_role',
  'dev_full_admin',
  'owner',
  'owner_role',
]);

const DEV_ROLE_CODE_PATTERNS = [/^dev_/, /^dev-/, /_temp$/, /^no_access$/];

export type UserRbacRoleSummary = {
  id: string;
  name: string;
  code: string;
  is_system: boolean;
  is_active: boolean;
  assignment_id: string;
  assignment_active: boolean;
  assigned_at: string | null;
  assigned_by: string | null;
  expires_at: string | null;
  is_expired: boolean;
  is_current: boolean;
  permission_count: number;
  is_dev_verification_role: boolean;
};

export type UserRbacPermissionSummary = {
  code: string;
  module: string;
  feature: string;
  action: string;
  description: string | null;
  source_roles: Array<{ id: string; name: string; code: string }>;
};

export type UserStoreScopeSummary = {
  id: string;
  store_id: string;
  store_code: string | null;
  store_name: string | null;
  short_name: string | null;
  role_type: string;
  is_primary: boolean;
  store_is_active: boolean | null;
};

type SupabaseAdminClient = any;

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

export function isDevTestAccount(email: string | null | undefined) {
  const normalized = (email || '').toLowerCase();
  return normalized.endsWith('@example.test') || normalized.startsWith('dev-');
}

function isDevVerificationRole(role: { code?: string | null; name?: string | null; description?: string | null }) {
  const code = (role.code || '').toLowerCase();
  const name = (role.name || '').toLowerCase();
  const description = (role.description || '').toLowerCase();

  return (
    DEV_ROLE_CODE_PATTERNS.some((pattern) => pattern.test(code)) ||
    name.startsWith('dev ') ||
    name.startsWith('dev_') ||
    description.includes('temporary dev verification role') ||
    description.includes('dev-only')
  );
}

export function isAdminLikeLegacyOrRole(profileRole: string | null | undefined, roleCodes: string[]) {
  if (profileRole === 'admin') return true;
  return roleCodes.some((code) => ADMIN_LIKE_ROLE_CODES.has(code));
}

function normalizeRole(row: any) {
  const role = Array.isArray(row.role) ? row.role[0] : row.role;
  if (!role) return null;
  const expired = isExpired(row.expires_at);
  const current = row.is_active === true && role.is_active === true && !expired;

  return {
    id: role.id,
    name: role.name,
    code: role.code,
    description: role.description || null,
    is_system: role.is_system === true,
    is_active: role.is_active === true,
    assignment_id: row.id,
    assignment_active: row.is_active === true,
    assigned_at: row.assigned_at || null,
    assigned_by: row.assigned_by || null,
    expires_at: row.expires_at || null,
    is_expired: expired,
    is_current: current,
    permission_count: 0,
    is_dev_verification_role: isDevVerificationRole(role),
  };
}

function normalizePermission(row: any) {
  const permission = Array.isArray(row.permission) ? row.permission[0] : row.permission;
  if (!permission) return null;
  return {
    id: permission.id,
    code: permission.code,
    module: permission.module,
    feature: permission.feature,
    action: permission.action,
    description: permission.description || null,
    is_active: permission.is_active === true,
  };
}

export async function getUserRbacListSummaries(adminSupabase: SupabaseAdminClient, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, {
    roles: UserRbacRoleSummary[];
    effective_permission_count: number;
    store_scope_count: number;
  }>();

  const summaries = new Map<string, {
    roles: UserRbacRoleSummary[];
    effective_permission_count: number;
    store_scope_count: number;
  }>();

  userIds.forEach((id) => summaries.set(id, {
    roles: [],
    effective_permission_count: 0,
    store_scope_count: 0,
  }));

  const { data: roleRows, error: roleError } = await adminSupabase
    .from('user_roles')
    .select(`
      id,
      user_id,
      is_active,
      assigned_at,
      assigned_by,
      expires_at,
      role:roles(id, name, code, description, is_system, is_active)
    `)
    .in('user_id', userIds);

  if (roleError) {
    console.error('取得使用者 RBAC 角色摘要錯誤:', roleError);
  }

  const currentRolesByUser = new Map<string, UserRbacRoleSummary[]>();
  const currentRoleIds = new Set<string>();

  (roleRows || []).forEach((row: any) => {
    const role = normalizeRole(row);
    if (!role) return;
    const summary = summaries.get(row.user_id);
    if (!summary) return;
    summary.roles.push(role);
    if (role.is_current) {
      currentRoleIds.add(role.id);
      const roles = currentRolesByUser.get(row.user_id) || [];
      roles.push(role);
      currentRolesByUser.set(row.user_id, roles);
    }
  });

  if (currentRoleIds.size > 0) {
    const { data: permissionRows, error: permissionError } = await adminSupabase
      .from('role_permissions')
      .select(`
        role_id,
        is_allowed,
        permission:permissions(id, code, module, feature, action, description, is_active)
      `)
      .in('role_id', Array.from(currentRoleIds));

    if (permissionError) {
      console.error('取得使用者 RBAC 權限摘要錯誤:', permissionError);
    } else {
      const permissionCodesByRole = new Map<string, Set<string>>();
      (permissionRows || []).forEach((row: any) => {
        const permission = normalizePermission(row);
        if (!permission || row.is_allowed !== true || !permission.is_active) return;
        const codes = permissionCodesByRole.get(row.role_id) || new Set<string>();
        codes.add(permission.code);
        permissionCodesByRole.set(row.role_id, codes);
      });

      currentRolesByUser.forEach((roles, userId) => {
        const effectiveCodes = new Set<string>();
        roles.forEach((role) => {
          const roleCodes = permissionCodesByRole.get(role.id) || new Set<string>();
          role.permission_count = roleCodes.size;
          roleCodes.forEach((code) => effectiveCodes.add(code));
        });
        const summary = summaries.get(userId);
        if (summary) summary.effective_permission_count = effectiveCodes.size;
      });
    }
  }

  const { data: scopeRows, error: scopeError } = await adminSupabase
    .from('store_managers')
    .select('user_id')
    .in('user_id', userIds);

  if (scopeError) {
    console.error('取得使用者門市範圍摘要錯誤:', scopeError);
  } else {
    (scopeRows || []).forEach((row: any) => {
      const summary = summaries.get(row.user_id);
      if (summary) summary.store_scope_count += 1;
    });
  }

  summaries.forEach((summary) => {
    summary.roles.sort((a, b) => {
      if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
      return a.code.localeCompare(b.code);
    });
  });

  return summaries;
}

export async function getUserRbacDetail(adminSupabase: SupabaseAdminClient, userId: string) {
  const { data: profile, error: profileError } = await adminSupabase
    .from('profiles')
    .select('id, email, full_name, role, department, job_title, employee_code, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return null;

  const { data: authUserResult } = await adminSupabase.auth.admin.getUserById(userId);
  const authUser = authUserResult?.user || null;

  const { data: roleRows, error: roleError } = await adminSupabase
    .from('user_roles')
    .select(`
      id,
      user_id,
      is_active,
      assigned_at,
      assigned_by,
      expires_at,
      role:roles(id, name, code, description, is_system, is_active)
    `)
    .eq('user_id', userId)
    .order('assigned_at', { ascending: false });

  if (roleError) throw roleError;

  const roles = (roleRows || [])
    .map(normalizeRole)
    .filter(Boolean) as UserRbacRoleSummary[];

  const currentRoles = roles.filter((role) => role.is_current);
  const currentRoleIds = currentRoles.map((role) => role.id);
  const rolePermissionRows: any[] = [];

  if (currentRoleIds.length > 0) {
    const { data, error } = await adminSupabase
      .from('role_permissions')
      .select(`
        role_id,
        is_allowed,
        permission:permissions(id, code, module, feature, action, description, is_active)
      `)
      .in('role_id', currentRoleIds);

    if (error) throw error;
    rolePermissionRows.push(...(data || []));
  }

  const currentRoleById = new Map(currentRoles.map((role) => [role.id, role]));
  const effectivePermissionMap = new Map<string, UserRbacPermissionSummary>();
  const rolePermissionDetails: Array<UserRbacPermissionSummary & {
    role_id: string;
    role_name: string;
    role_code: string;
  }> = [];

  rolePermissionRows.forEach((row) => {
    const permission = normalizePermission(row);
    const role = currentRoleById.get(row.role_id);
    if (!permission || !role || row.is_allowed !== true || !permission.is_active) return;

    role.permission_count += 1;

    const existing: UserRbacPermissionSummary = effectivePermissionMap.get(permission.code) || {
      code: permission.code,
      module: permission.module,
      feature: permission.feature,
      action: permission.action,
      description: permission.description,
      source_roles: [],
    };

    if (!existing.source_roles.some((source) => source.id === role.id)) {
      existing.source_roles.push({
        id: role.id,
        name: role.name,
        code: role.code,
      });
    }

    effectivePermissionMap.set(permission.code, existing);
    rolePermissionDetails.push({
      code: permission.code,
      module: permission.module,
      feature: permission.feature,
      action: permission.action,
      description: permission.description,
      source_roles: [{ id: role.id, name: role.name, code: role.code }],
      role_id: role.id,
      role_name: role.name,
      role_code: role.code,
    });
  });

  const effectivePermissions = Array.from(effectivePermissionMap.values())
    .map((permission) => ({
      ...permission,
      source_roles: permission.source_roles.sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const currentRoleCodes = currentRoles.map((role) => role.code);
  const adminCompatibility = isAdminLikeLegacyOrRole(profile.role, currentRoleCodes);
  const permissionSet = new Set(effectivePermissions.map((permission) => permission.code));
  const hasPermission = (code: string) => adminCompatibility || permissionSet.has(code);

  const { data: storeRows, error: storeError } = await adminSupabase
    .from('store_managers')
    .select(`
      id,
      store_id,
      role_type,
      is_primary,
      store:stores(id, store_code, store_name, short_name, is_active)
    `)
    .eq('user_id', userId);

  if (storeError) throw storeError;

  const storeScopes: UserStoreScopeSummary[] = ((storeRows || []).map((row: any) => {
    const store = Array.isArray(row.store) ? row.store[0] : row.store;
    return {
      id: row.id,
      store_id: row.store_id,
      store_code: store?.store_code || null,
      store_name: store?.store_name || null,
      short_name: store?.short_name || null,
      role_type: row.role_type,
      is_primary: row.is_primary === true,
      store_is_active: typeof store?.is_active === 'boolean' ? store.is_active : null,
    };
  }) as UserStoreScopeSummary[]).sort((a, b) => (a.store_code || '').localeCompare(b.store_code || ''));

  return {
    user: {
      id: profile.id,
      email: profile.email || authUser?.email || null,
      full_name: profile.full_name,
      employee_code: profile.employee_code,
      legacy_role: profile.role,
      department: profile.department,
      job_title: profile.job_title,
      is_disabled: Boolean(authUser?.banned_until),
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      is_dev_test_account: isDevTestAccount(profile.email || authUser?.email),
    },
    roles: roles.sort((a, b) => {
      if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
      return a.code.localeCompare(b.code);
    }),
    role_permissions: rolePermissionDetails.sort((a, b) => {
      const roleSort = a.role_code.localeCompare(b.role_code);
      return roleSort !== 0 ? roleSort : a.code.localeCompare(b.code);
    }),
    effective_permissions: effectivePermissions,
    legacy_compatibility: {
      is_admin_like: adminCompatibility,
      source:
        profile.role === 'admin'
          ? 'profiles.role=admin'
          : currentRoleCodes.find((code) => ADMIN_LIKE_ROLE_CODES.has(code)) || null,
      note: adminCompatibility
        ? '管理員相容 bypass 會允許管理介面，但不會偽裝成 role_permissions 來源。'
        : null,
    },
    store_scopes: storeScopes,
    validation_summary: {
      can_view_users: hasPermission('user.user.view'),
      can_view_roles: hasPermission('role.role.view'),
      can_access_general_affairs_service: hasPermission('general_affairs.service_center.access'),
      can_view_inventory_balances: hasPermission('general_affairs.inventory_balance.view'),
      can_view_inventory_transactions:
        hasPermission('general_affairs.inventory_transaction.view') ||
        hasPermission('general_affairs.inventory_transaction.manage'),
      can_post_inventory_transactions: hasPermission('general_affairs.inventory_transaction.manage'),
      can_view_parts:
        hasPermission('general_affairs.part.view') ||
        hasPermission('general_affairs.part.manage'),
      store_scope_count: storeScopes.length,
      store_manager_scope_label:
        storeScopes.length > 0
          ? `可見 ${storeScopes.length} 個門市範圍`
          : '無門市範圍',
    },
  };
}
