// ============================================
// 權限快照：一次載入使用者的 profile / 角色 / 權限，之後在記憶體內判斷
// ============================================
//
// 目的：每月人員狀態頁等「一次要判斷很多權限旗標」的地方，原本每個旗標都呼叫 hasPermission()，
// 每次 2–3 次資料庫往返（profile、user_roles、RPC has_permission）。這裡改成一次平行載入，
// 在記憶體內算出與 hasPermission() 完全相同的結果。
//
// 語意（必須與 lib/permissions/check.ts 的 hasPermission 逐項一致）：
//   hasPermission(userId, code) =
//        isAdminLikeUser(userId)                     // 管理員保底：profiles.role === 'admin'，
//                                                    // 或有效 user_roles 的角色 code 在保底名單內（不檢查 roles.is_active）
//     || DB has_permission(userId, code)              // 資料庫函式：
//          - 有效 user_roles 且 roles.is_active 且 roles.code = 'admin'，或
//          - 有效 user_roles + roles.is_active + role_permissions.is_allowed + permissions.is_active + code 相符
//   「有效 user_roles」= user_roles.is_active = true 且 (expires_at 為空或晚於現在)
//
// 讀取方式：
//   - profiles / user_roles(role code)：用使用者自己的 client（與 isAdminLikeUser 相同，受 RLS 約束）
//   - user_roles → roles → role_permissions → permissions：用 service client 讀取「該使用者自己」的資料
//     （has_permission 是 SECURITY DEFINER，不受 RLS 限制，所以要用等價的讀取權限；
//      與 getUserPermissions 同樣做法，且只用已驗證登入的 userId 篩選）。

type DbLike = { from: (table: string) => any };

/** 與 lib/permissions/check.ts 的 isAdminLikeUser 相同的管理員保底角色代碼 */
const ADMIN_LIKE_ROLE_CODES = [
  'admin',
  'system_admin',
  'admin_role',
  'full_admin',
  'full_admin_role',
  'dev_full_admin',
  'owner',
  'owner_role',
];

export type PermissionSnapshotProfile = {
  role: string | null;
  department: string | null;
  job_title: string | null;
};

export type PermissionSnapshot = {
  userId: string;
  /** profiles 的 role / department / job_title（查不到時為 null） */
  profile: PermissionSnapshotProfile | null;
  /** isAdminLikeUser 的結果 */
  isAdminLike: boolean;
  /** 等同 await hasPermission(userId, code) */
  has: (permissionCode: string) => boolean;
};

function isNotExpired(expiresAt: string | null | undefined, now: number): boolean {
  const t = expiresAt ? new Date(expiresAt).getTime() : null;
  return t === null || t > now;
}

export async function loadPermissionSnapshot(
  userDb: DbLike,
  adminDb: DbLike,
  userId: string
): Promise<PermissionSnapshot> {
  const [profileRes, adminLikeRolesRes, grantRes] = await Promise.all([
    // 1) profile（isAdminLikeUser 用 role；getUserManagedStores / 活動入口用 department、job_title）
    Promise.resolve(
      userDb.from('profiles').select('role, department, job_title').eq('id', userId).maybeSingle()
    ).catch((error: unknown) => ({ data: null, error })),
    // 2) 管理員保底：使用者 client 讀自己的 user_roles（與 isAdminLikeUser 相同）
    Promise.resolve(
      userDb
        .from('user_roles')
        .select('is_active, expires_at, role:roles(code)')
        .eq('user_id', userId)
        .eq('is_active', true)
    ).catch((error: unknown) => ({ data: null, error })),
    // 3) 等價於 DB has_permission 的資料：service client 讀自己的角色與權限
    Promise.resolve(
      adminDb
        .from('user_roles')
        .select('expires_at, role:roles(code, is_active, role_permissions(is_allowed, permission:permissions(code, is_active)))')
        .eq('user_id', userId)
        .eq('is_active', true)
    ).catch((error: unknown) => ({ data: null, error })),
  ]);

  const now = Date.now();
  const profile: PermissionSnapshotProfile | null = (profileRes && profileRes.data) || null;

  // ---- isAdminLikeUser 等價計算
  let isAdminLike = false;
  if (profile?.role === 'admin') {
    isAdminLike = true;
  } else if (!adminLikeRolesRes.error && Array.isArray(adminLikeRolesRes.data)) {
    isAdminLike = adminLikeRolesRes.data.some((row: any) => {
      const roleCode = row?.role?.code;
      return isNotExpired(row?.expires_at, now) && ADMIN_LIKE_ROLE_CODES.includes(roleCode);
    });
  }

  // ---- DB has_permission 等價計算
  let dbAdmin = false;
  const granted = new Set<string>();
  if (grantRes.error) {
    console.error('權限快照讀取錯誤:', grantRes.error);
  } else {
    for (const ur of (grantRes.data || []) as any[]) {
      if (!isNotExpired(ur?.expires_at, now)) continue;
      const role = ur?.role;
      if (!role || role.is_active !== true) continue;
      if (role.code === 'admin') dbAdmin = true;
      for (const rp of (role.role_permissions || []) as any[]) {
        if (rp?.is_allowed === true && rp?.permission?.is_active === true && typeof rp.permission.code === 'string') {
          granted.add(rp.permission.code);
        }
      }
    }
  }

  const has = (permissionCode: string): boolean => {
    if (isAdminLike) return true;
    if (!permissionCode || String(permissionCode).trim() === '') return false;
    return dbAdmin || granted.has(permissionCode);
  };

  return { userId, profile, isAdminLike, has };
}
