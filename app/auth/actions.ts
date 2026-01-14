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

    // Check if current user is admin or manager
    const currentUser = await getCurrentUser();
    const userRole = currentUser.user?.profile?.role;
    
    if (!currentUser.success || (userRole !== 'admin' && userRole !== 'manager')) {
      return { success: false, error: '權限不足', data: [] };
    }

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
