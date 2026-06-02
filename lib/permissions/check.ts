// ============================================
// 權限檢查函數
// ============================================

import { createClient } from '@/lib/supabase/server';

async function isAdminLikeUser(userId: string): Promise<boolean> {
  try {
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.role === 'admin') {
      return true;
    }

    const { data: userRoles, error } = await supabase
      .from('user_roles')
      .select('is_active, expires_at, role:roles(code)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error || !userRoles) {
      return false;
    }

    const now = Date.now();
    return userRoles.some((row: any) => {
      const roleCode = row?.role?.code;
      const expiresAt = row?.expires_at ? new Date(row.expires_at).getTime() : null;
      const notExpired = expiresAt === null || expiresAt > now;
      return notExpired && ['admin', 'system_admin', 'admin_role'].includes(roleCode);
    });
  } catch (error) {
    console.error('管理員身份檢查異常:', error);
    return false;
  }
}

/**
 * 檢查使用者是否擁有指定權限
 */
export async function hasPermission(
  userId: string,
  permissionCode: string
): Promise<boolean> {
  try {
    // 保底策略：管理員角色永遠允許，避免 DB 函式版本落後造成誤判。
    const isAdminLike = await isAdminLikeUser(userId);
    if (isAdminLike) {
      return true;
    }

    const supabase = await createClient();
    
    const { data, error } = await supabase
      .rpc('has_permission', {
        p_user_id: userId,
        p_permission_code: permissionCode
      });

    if (error) {
      console.error('權限檢查錯誤:', error);
      return false;
    }

    return data === true;
  } catch (error) {
    console.error('權限檢查異常:', error);
    return false;
  }
}

/**
 * 檢查使用者是否擁有任一權限
 */
export async function hasAnyPermission(
  userId: string,
  permissionCodes: string[]
): Promise<boolean> {
  try {
    for (const code of permissionCodes) {
      const allowed = await hasPermission(userId, code);
      if (allowed) return true;
    }
    return false;
  } catch (error) {
    console.error('權限檢查異常:', error);
    return false;
  }
}

/**
 * 檢查使用者是否擁有所有權限
 */
export async function hasAllPermissions(
  userId: string,
  permissionCodes: string[]
): Promise<boolean> {
  try {
    for (const code of permissionCodes) {
      const allowed = await hasPermission(userId, code);
      if (!allowed) return false;
    }
    return true;
  } catch (error) {
    console.error('權限檢查異常:', error);
    return false;
  }
}

/**
 * 取得使用者所有權限
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .rpc('get_user_permissions', {
        p_user_id: userId
      });

    if (error) {
      console.error('取得權限列表錯誤:', error);
      return [];
    }

    return (data || []).map((row: any) => row.permission_code);
  } catch (error) {
    console.error('取得權限列表異常:', error);
    return [];
  }
}

/**
 * 取得使用者的角色列表
 */
export async function getUserRoles(userId: string) {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('user_roles')
      .select(`
        id,
        is_active,
        assigned_at,
        expires_at,
        role:roles(
          id,
          name,
          code,
          description,
          is_system
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.now()');

    if (error) {
      console.error('取得角色列表錯誤:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('取得角色列表異常:', error);
    return [];
  }
}

/**
 * 權限檢查中間件 - 用於 API routes
 */
export async function requirePermission(
  userId: string,
  permissionCode: string
): Promise<{ allowed: boolean; message?: string }> {
  const allowed = await hasPermission(userId, permissionCode);
  
  if (!allowed) {
    return {
      allowed: false,
      message: `權限不足: 需要 ${permissionCode} 權限`
    };
  }
  
  return { allowed: true };
}
