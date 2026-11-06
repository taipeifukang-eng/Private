// ============================================
// 權限快照：一次載入使用者的 profile / 角色 / 權限，之後在記憶體內判斷
// ============================================
//
// 目的：每月人員狀態頁等「一次要判斷很多權限旗標」的地方，原本每個旗標都呼叫 hasPermission()，
// 每次 2–3 次資料庫往返（profile、user_roles、RPC has_permission）。這裡改成一次平行載入，
// 在記憶體內算出與 hasPermission() 完全相同的結果。
//
// 語意（必須與 lib/permissions/check.ts 的 hasPermission 逐項一致；DB 端以「正式區」has_permission 定義為準，
// 2026-11-06 由正式區唯讀查詢確認）：
//   hasPermission(userId, code) =
//        isAdminLikeUser(userId)                     // 應用層保底（照舊）：profiles.role === 'admin'，
//                                                    // 或有效 user_roles 的角色 code 在保底名單內（不檢查 roles.is_active）
//     || DB has_permission(userId, code)              // 正式區資料庫函式（SECURITY DEFINER）：
//          EXISTS user_roles ur JOIN role_permissions rp (ur.role_id = rp.role_id) JOIN permissions p (rp.permission_id = p.id)
//          WHERE ur.user_id = userId AND ur.is_active
//            AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
//            AND rp.is_allowed AND p.code = code AND p.is_active
//        重點：不檢查 roles.is_active（角色停用仍放行）、資料庫端沒有 role.code = 'admin' 的放行。
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
        .select('expires_at, role:roles(role_permissions(is_allowed, permission:permissions(code, is_active)))')
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

  // ---- 正式區 DB has_permission 等價計算（不看 roles.is_active，也沒有 role.code = 'admin' 放行）
  const granted = new Set<string>();
  if (grantRes.error) {
    console.error('權限快照讀取錯誤:', grantRes.error);
  } else {
    for (const ur of (grantRes.data || []) as any[]) {
      if (!isNotExpired(ur?.expires_at, now)) continue;
      for (const rp of (ur?.role?.role_permissions || []) as any[]) {
        if (rp?.is_allowed === true && rp?.permission?.is_active === true && typeof rp.permission.code === 'string') {
          granted.add(rp.permission.code);
        }
      }
    }
  }

  const has = (permissionCode: string): boolean => {
    if (isAdminLike) return true;
    return granted.has(permissionCode);
  };

  return { userId, profile, isAdminLike, has };
}

/**
 * 備援快照：當 service client 無法建立（例如環境變數缺 SUPABASE_SERVICE_ROLE_KEY）時使用。
 * 行為與改前相同：對指定的權限代碼逐項呼叫原本的 hasPermission（走使用者 client + RPC），
 * 結果預先算好後放進快照；沒列在 codes 內的代碼一律視為無權限。
 */
export async function loadLegacyPermissionSnapshot(
  userDb: DbLike,
  userId: string,
  codes: readonly string[],
  checkPermission: (userId: string, code: string) => Promise<boolean>
): Promise<PermissionSnapshot> {
  const unique = Array.from(new Set(codes));
  const [profileRes, results] = await Promise.all([
    Promise.resolve(
      userDb.from('profiles').select('role, department, job_title').eq('id', userId).maybeSingle()
    ).catch((error: unknown) => ({ data: null, error })),
    Promise.all(unique.map(async (code) => [code, await checkPermission(userId, code)] as const)),
  ]);
  const granted = new Set(results.filter(([, ok]) => ok).map(([code]) => code));
  const profile: PermissionSnapshotProfile | null = (profileRes && (profileRes as any).data) || null;
  return {
    userId,
    profile,
    isAdminLike: profile?.role === 'admin',
    has: (code: string) => granted.has(code),
  };
}
