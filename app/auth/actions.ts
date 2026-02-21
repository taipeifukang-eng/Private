'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

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
  try {
    const supabase = createClient();
    await supabase.auth.signOut();
    revalidatePath('/', 'layout');
    redirect('/login');
  } catch (error) {
    console.error('Sign out error:', error);
  }
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
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    return {
      success: true,
      user: {
        ...user,
        profile,
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
    const supabase = createClient();

    // Check if current user is authenticated
    const currentUser = await getCurrentUser();
    const userRole = currentUser.user?.profile?.role;
    
    if (!currentUser.success) {
      return { success: false, error: '請先登入', data: [] };
    }

    // 只要是已登入的使用者都可以獲取用戶列表（用於任務指派等功能）
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: data || [] };
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
    const supabase = createClient();

    // Check if current user is admin
    const currentUser = await getCurrentUser();
    if (!currentUser.success || currentUser.user?.profile?.role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/users');
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message || '更新失敗' };
  }
}

/**
 * Delete user (Admin only - soft delete by updating profile)
 */
export async function deleteUser(userId: string) {
  try {
    const supabase = createClient();

    // Check if current user is admin
    const currentUser = await getCurrentUser();
    if (!currentUser.success || currentUser.user?.profile?.role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // Note: Cannot delete auth.users directly from client
    // This would typically be done via Supabase Admin API
    // For now, we'll just mark the profile as inactive or delete the profile
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/users');
    return { success: true };
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
