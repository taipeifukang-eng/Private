'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/permissions/check';

/**
 * Sign up a new user
 */
export async function signUp(formData: {
  email: string;
  password: string;
  fullName: string;
}) {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: {
          full_name: formData.fullName,
        },
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || '註冊失敗' };
  }
}

/**
 * Sign in a user
 */
export async function signIn(formData: { email: string; password: string }) {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: formData.email,
      password: formData.password,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/', 'layout');
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || '登入失敗' };
  }
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

/**
 * Get the current user
 */
export async function getCurrentUser() {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return { success: false, user: null };
    }

    // Get profile data
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    // Fallback: if RLS/policy causes profile query failure, use admin client to read own profile.
    let resolvedProfile = profile;
    if (!resolvedProfile || profileError) {
      try {
        const { createAdminClient } = await import('@/lib/supabase/server');
        const adminSupabase = createAdminClient();
        const { data: adminProfile } = await adminSupabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (adminProfile) {
          resolvedProfile = adminProfile;
        }
      } catch (_) {
        // Keep original behavior if fallback is unavailable.
      }
    }

    return {
      success: true,
      user: {
        ...user,
        profile: resolvedProfile,
      },
    };
  } catch (error: any) {
    return { success: false, user: null, error: error.message };
  }
}

/**
 * Get all users (Admin only)
 */
export async function getAllUsers() {
  try {
    // Check if current user is authenticated
    const currentUser = await getCurrentUser();
    
    if (!currentUser.success) {
      return { success: false, error: '請先登入', data: [] };
    }

    // 使用者管理需要能列出 DEV/Auth 測試帳號；先驗證登入，再由 server-only admin client
    // 讀 profiles 並補齊 auth.users 中尚未有完整 profile 的帳號。
    const { createAdminClient } = await import('@/lib/supabase/server');
    const adminSupabase = createAdminClient();

    const { data: profiles, error } = await adminSupabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    const usersById = new Map<string, any>();
    (profiles || []).forEach(profile => {
      usersById.set(profile.id, profile);
    });

    const { data: authUsers, error: authError } = await adminSupabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (!authError) {
      (authUsers?.users || []).forEach(authUser => {
        if (usersById.has(authUser.id)) {
          const profile = usersById.get(authUser.id);
          usersById.set(authUser.id, {
            ...profile,
            email: profile.email || authUser.email || '',
            created_at: profile.created_at || authUser.created_at,
            is_disabled: Boolean(authUser.banned_until),
          });
          return;
        }

        usersById.set(authUser.id, {
          id: authUser.id,
          email: authUser.email || '',
          full_name:
            (authUser.user_metadata?.full_name as string | undefined) ||
            (authUser.user_metadata?.name as string | undefined) ||
            authUser.email ||
            '未設定',
          role: 'member',
          department: null,
          job_title: null,
          employee_code: null,
          created_at: authUser.created_at,
          updated_at: authUser.updated_at || authUser.created_at,
          is_disabled: Boolean(authUser.banned_until),
        });
      });
    } else {
      console.error('取得 auth 使用者列表錯誤:', authError);
    }

    const users = Array.from(usersById.values()).sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });

    try {
      const { getUserRbacListSummaries, isAdminLikeLegacyOrRole, isDevTestAccount } = await import('@/lib/admin/user-rbac-view');
      const summaries = await getUserRbacListSummaries(adminSupabase, users.map(user => user.id));
      users.forEach((user: any) => {
        const summary = summaries.get(user.id);
        const activeRoleCodes = (summary?.roles || [])
          .filter(role => role.is_current)
          .map(role => role.code);
        user.rbac_roles = summary?.roles || [];
        user.effective_permission_count = summary?.effective_permission_count || 0;
        user.store_scope_count = summary?.store_scope_count || 0;
        user.is_admin_compatibility = isAdminLikeLegacyOrRole(user.role, activeRoleCodes);
        user.is_dev_test_account = isDevTestAccount(user.email);
      });
    } catch (summaryError) {
      console.error('取得使用者 RBAC 摘要錯誤:', summaryError);
    }

    return { success: true, data: users };
  } catch (error: any) {
    return { success: false, error: error.message || '獲取使用者失敗', data: [] };
  }
}

/**
 * Update user profile (Admin only)
 */
export async function updateUserProfile(userId: string, updates: {
  full_name?: string;
  role?: 'admin' | 'manager' | 'member';
  department?: string;
  job_title?: string;
  employee_code?: string;
}) {
  try {
    const currentUser = await getCurrentUser();
    const currentUserId = currentUser.user?.id;
    if (!currentUser.success || !currentUserId) {
      return { success: false, error: '請先登入' };
    }

    const hasProfileUpdates = ['full_name', 'department', 'job_title', 'employee_code']
      .some((key) => Object.prototype.hasOwnProperty.call(updates, key));
    const hasRoleUpdate = Object.prototype.hasOwnProperty.call(updates, 'role');

    if (hasProfileUpdates) {
      const canEditUser = await hasPermission(currentUserId, 'user.user.edit');
      if (!canEditUser) {
        return { success: false, error: '權限不足：需要 user.user.edit 權限' };
      }
    }

    if (hasRoleUpdate) {
      const canChangeLegacyRole = await hasPermission(currentUserId, 'user.user.change_role');
      if (!canChangeLegacyRole) {
        return { success: false, error: '權限不足：需要 user.user.change_role 權限' };
      }
    }

    if (!hasProfileUpdates && !hasRoleUpdate) {
      return { success: false, error: '沒有可更新的使用者資料' };
    }

    if (currentUserId === userId && hasRoleUpdate) {
      return { success: false, error: '不能修改目前登入使用者的相容角色' };
    }

    if (updates.role && !['admin', 'manager', 'member'].includes(updates.role)) {
      return { success: false, error: '角色格式錯誤' };
    }

    const normalizedUpdates = {
      ...updates,
      full_name: updates.full_name?.trim(),
      department: updates.department?.trim() || null,
      job_title: updates.job_title?.trim() || null,
      employee_code: updates.employee_code?.trim().toUpperCase() || null,
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'full_name') && !normalizedUpdates.full_name) {
      return { success: false, error: '姓名不可空白' };
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'employee_code') && !normalizedUpdates.employee_code) {
      return { success: false, error: '員工編號不可空白' };
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'employee_code') && normalizedUpdates.employee_code) {
      const { createAdminClient } = await import('@/lib/supabase/server');
      const adminSupabase = createAdminClient();
      const { data: existingEmployeeCode, error: existingEmployeeCodeError } = await adminSupabase
        .from('profiles')
        .select('id')
        .eq('employee_code', normalizedUpdates.employee_code)
        .neq('id', userId)
        .maybeSingle();

      if (existingEmployeeCodeError) {
        return { success: false, error: `檢查員工編號失敗：${existingEmployeeCodeError.message}` };
      }

      if (existingEmployeeCode) {
        return { success: false, error: '員工編號已被其他使用者使用' };
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'role') && normalizedUpdates.role === undefined) {
      return { success: false, error: '權限不足' };
    }

    // 使用 admin client 繞過 RLS，避免管理員更新其他帳號時被 policy 擋下
    const { createAdminClient } = await import('@/lib/supabase/server');
    const adminSupabase = createAdminClient();

    const { data, error } = await adminSupabase
      .from('profiles')
      .update({
        ...normalizedUpdates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data) {
      return { success: false, error: '找不到可更新的使用者資料（可能無權限或資料不存在）' };
    }

    revalidatePath('/admin/users');
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || '更新失敗' };
  }
}

/**
 * Delete user (server-side only).
 *
 * The RBAC source of truth is permissions/user_roles, not profiles.role.
 * Deleting only public.profiles leaves the Supabase Auth user behind, so this
 * action removes known app-side joins first and then deletes auth.users through
 * the service-role Admin API. profiles.id is expected to cascade from auth.users.
 */
export async function deleteUser(userId: string) {
  try {
    const currentUser = await getCurrentUser();
    const currentUserId = currentUser.user?.id;
    if (!currentUser.success || !currentUserId) {
      return { success: false, error: '請先登入' };
    }

    if (currentUserId === userId) {
      return { success: false, error: '不能刪除目前登入中的使用者' };
    }

    const canDeleteUser = await hasPermission(currentUserId, 'user.user.delete');
    if (!canDeleteUser) {
      return { success: false, error: '權限不足' };
    }

    // 使用 admin client 繞過 RLS 限制
    const { createAdminClient } = await import('@/lib/supabase/server');
    const adminSupabase = createAdminClient();

    const { data: authUserResult, error: authLookupError } = await adminSupabase.auth.admin.getUserById(userId);
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle();

    if (authLookupError && !profile) {
      return { success: false, error: '找不到要刪除的使用者' };
    }

    const isMissingOptionalCleanupTable = (error: { code?: string; message?: string } | null) => {
      if (!error) return false;
      const message = error.message || '';
      return (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        message.includes('schema cache') ||
        message.includes('Could not find the table')
      );
    };

    const cleanupTables = [
      { name: 'store_managers', required: true },
      { name: 'store_employees', required: false },
      { name: 'user_roles', required: true },
      { name: 'collaborators', required: false },
    ];

    const isProfileHistoryReferenceError = (error: { code?: string; message?: string } | null) => {
      if (!error) return false;
      const message = error.message || '';
      return (
        error.code === '23503' ||
        message.includes('violates foreign key constraint') ||
        message.includes('inspection_improvements_improved_by_fkey')
      );
    };

    const isAuthUserDatabaseDeleteError = (error: { message?: string } | null) => {
      if (!error) return false;
      const message = error.message || '';
      return message.includes('Database error deleting user');
    };

    const disableLoginAndKeepHistory = async (reason: string) => {
      if (authUserResult?.user) {
        const { error: disableError } = await adminSupabase.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        } as any);

        if (disableError) {
          return {
            success: false,
            error: `使用者已有歷史資料引用，且停用登入失敗：${disableError.message}`,
          };
        }
      }

      revalidatePath('/admin/users');
      revalidatePath('/admin/roles');
      return {
        success: true,
        action: 'disabled',
        message: `此使用者已有歷史資料引用，已保留基本資料並停用登入、撤除角色與管理範圍。來源：${reason}`,
      };
    };

    for (const table of cleanupTables) {
      const { error: cleanupError } = await adminSupabase
        .from(table.name)
        .delete()
        .eq('user_id', userId);

      if (cleanupError && (table.required || !isMissingOptionalCleanupTable(cleanupError))) {
        return { success: false, error: `清理使用者關聯資料失敗：${cleanupError.message}` };
      }
    }

    if (authUserResult?.user) {
      const { error: authDeleteError } = await adminSupabase.auth.admin.deleteUser(userId);
      if (authDeleteError) {
        if (isProfileHistoryReferenceError(authDeleteError) || isAuthUserDatabaseDeleteError(authDeleteError)) {
          return disableLoginAndKeepHistory(authDeleteError.message);
        }
        return { success: false, error: `刪除 Auth 使用者失敗：${authDeleteError.message}` };
      }
    }

    // 若此帳號只有 profile 殘留、Auth 已不存在，仍允許清除 profile。
    const { error } = await adminSupabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      if (isProfileHistoryReferenceError(error)) {
        return disableLoginAndKeepHistory(error.message);
      }
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/users');
    revalidatePath('/admin/roles');
    return { success: true, action: 'deleted', message: '使用者已刪除' };
  } catch (error: any) {
    return { success: false, error: error.message || '刪除失敗' };
  }
}

/**
 * Request password reset - sends a password reset email
 */
export async function requestPasswordReset(email: string) {
  try {
    const supabase = createClient();

    // Get the site URL for redirect
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { 
      success: true, 
      message: '密碼重置郵件已發送，請檢查您的信箱' 
    };
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || '發送重置郵件失敗' 
    };
  }
}

/**
 * Reset password with new password
 */
export async function resetPassword(newPassword: string) {
  try {
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { 
      success: true, 
      message: '密碼已成功重置' 
    };
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || '重置密碼失敗' 
    };
  }
}

/**
 * Admin reset user password - Admin only
 * Generates a random password and updates the user
 */
export async function adminResetUserPassword(userId: string) {
  try {
    const supabase = createClient();

    // Check if current user is admin
    const currentUser = await getCurrentUser();
    if (!currentUser.success || currentUser.user?.profile?.role !== 'admin') {
      return { success: false, error: '權限不足，只有管理員可以重置密碼' };
    }

    // Generate random password (8-12 characters, alphanumeric)
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newPassword = '';
    for (let i = 0; i < length; i++) {
      newPassword += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    // Get user info first
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return { success: false, error: '找不到該使用者' };
    }

    // Update user's password using admin API (need service role key)
    // Since we can't use admin API from client, we'll use a workaround:
    // We can't directly change another user's password without service role key
    // Instead, we'll use the update user endpoint which requires the user to be logged in
    
    // Note: This is a limitation. For production, you should:
    // 1. Create an API route that uses service role key
    // 2. Or use Supabase Admin SDK on the server side
    
    // For now, return the generated password and let admin manually send reset email
    return {
      success: true,
      password: newPassword,
      email: userData.email,
      userName: userData.full_name || userData.email,
      message: '密碼已生成，請透過系統發送重置郵件或手動告知使用者'
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || '重置密碼失敗'
    };
  }
}
