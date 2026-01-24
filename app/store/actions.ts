'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { 
  Store, 
  StoreManager, 
  StoreEmployee, 
  MonthlyStaffStatus, 
  MonthlyStoreSummary,
  MonthlyStatusType,
  EmploymentType 
} from '@/types/workflow';

// =====================================================
// 門市管理 Actions
// =====================================================

/**
 * 獲取所有門市
 */
export async function getStores() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('is_active', true)
      .order('store_code');

    if (error) {
      console.error('Error fetching stores:', error);
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * 建立新門市
 */
export async function createStore(data: {
  store_code: string;
  store_name: string;
  address?: string;
  phone?: string;
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { data: store, error } = await supabase
      .from('stores')
      .insert({
        store_code: data.store_code,
        store_name: data.store_name,
        address: data.address || null,
        phone: data.phone || null
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating store:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/stores');
    return { success: true, data: store };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 獲取用戶可管理的門市列表
 * - admin: 所有門市
 * - manager (督導/區經理): 被指派的門市
 * - store_manager (店長): 自己的門市
 */
export async function getUserManagedStores() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    // 獲取用戶角色
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return { success: false, error: '找不到用戶資料', data: [] };
    }

    // admin 可以看所有門市
    if (profile.role === 'admin') {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .order('store_code');

      if (error) {
        return { success: false, error: error.message, data: [] };
      }
      return { success: true, data: data || [], role: 'admin' };
    }

    // 其他角色只能看自己管理的門市
    const { data: managedStores, error } = await supabase
      .from('store_managers')
      .select(`
        *,
        store:stores(*)
      `)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error fetching managed stores:', error);
      return { success: false, error: error.message, data: [] };
    }

    const stores = managedStores
      ?.filter(m => m.store?.is_active)
      .map(m => m.store) || [];
    
    const roleType = managedStores?.[0]?.role_type || 'member';

    return { success: true, data: stores, role: roleType };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * 指派門市管理者
 */
export async function assignStoreManager(data: {
  store_id: string;
  user_id: string;
  role_type: 'store_manager' | 'supervisor' | 'area_manager';
  is_primary?: boolean;
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { data: manager, error } = await supabase
      .from('store_managers')
      .upsert({
        store_id: data.store_id,
        user_id: data.user_id,
        role_type: data.role_type,
        is_primary: data.is_primary || false
      }, {
        onConflict: 'store_id,user_id,role_type'
      })
      .select()
      .single();

    if (error) {
      console.error('Error assigning store manager:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/stores');
    revalidatePath('/admin/users');
    return { success: true, data: manager };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// 員工門市歸屬 Actions
// =====================================================

/**
 * 獲取門市員工列表
 */
export async function getStoreEmployees(storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    const { data, error } = await supabase
      .from('store_employees')
      .select(`
        *,
        user:profiles(id, email, full_name, role, department, job_title)
      `)
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('employee_code');

    if (error) {
      console.error('Error fetching store employees:', error);
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * 新增/更新員工門市歸屬
 */
export async function upsertStoreEmployee(data: {
  store_id: string;
  user_id: string;
  employee_code?: string;
  position?: string;
  employment_type: EmploymentType;
  is_pharmacist?: boolean;
  start_date?: string;
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    const { data: employee, error } = await supabase
      .from('store_employees')
      .upsert({
        store_id: data.store_id,
        user_id: data.user_id,
        employee_code: data.employee_code || null,
        position: data.position || null,
        employment_type: data.employment_type,
        is_pharmacist: data.is_pharmacist || false,
        start_date: data.start_date || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'store_id,user_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error upserting store employee:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/monthly-status');
    return { success: true, data: employee };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// 每月人員狀態 Actions
// =====================================================

/**
 * 獲取指定年月、門市的人員狀態列表
 */
export async function getMonthlyStaffStatus(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    const { data, error } = await supabase
      .from('monthly_staff_status')
      .select(`
        *,
        user:profiles(id, email, full_name)
      `)
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .order('employee_code');

    if (error) {
      console.error('Error fetching monthly staff status:', error);
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * 初始化指定年月、門市的人員狀態
 * 從 store_employees 複製當前員工名單
 */
export async function initializeMonthlyStatus(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查是否已有資料
    const { data: existing } = await supabase
      .from('monthly_staff_status')
      .select('id')
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .limit(1);

    if (existing && existing.length > 0) {
      return { success: true, message: '資料已存在', initialized: false };
    }

    // 獲取門市員工
    const { data: employees, error: empError } = await supabase
      .from('store_employees')
      .select(`
        *,
        user:profiles(id, email, full_name)
      `)
      .eq('store_id', storeId)
      .eq('is_active', true);

    if (empError) {
      return { success: false, error: empError.message };
    }

    if (!employees || employees.length === 0) {
      return { success: false, error: '該門市沒有員工資料' };
    }

    // 計算本月天數
    const [year, month] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    // 批量插入
    const statusRecords = employees.map(emp => ({
      year_month: yearMonth,
      store_id: storeId,
      user_id: emp.user_id,
      employee_code: emp.employee_code,
      employee_name: emp.user?.full_name || emp.user?.email || '',
      position: emp.position,
      employment_type: emp.employment_type,
      is_pharmacist: emp.is_pharmacist,
      monthly_status: 'full_month' as MonthlyStatusType,
      work_days: emp.employment_type === 'full_time' ? daysInMonth : null,
      total_days_in_month: daysInMonth,
      work_hours: emp.employment_type === 'part_time' ? 0 : null,
      is_dual_position: false,
      has_manager_bonus: emp.position?.includes('店長') || emp.position?.includes('代理店長') || false,
      is_supervisor_rotation: false,
      status: 'draft' as const
    }));

    const { error: insertError } = await supabase
      .from('monthly_staff_status')
      .insert(statusRecords);

    if (insertError) {
      console.error('Error initializing monthly status:', insertError);
      return { success: false, error: insertError.message };
    }

    // 初始化門市摘要
    await supabase
      .from('monthly_store_summary')
      .upsert({
        year_month: yearMonth,
        store_id: storeId,
        total_employees: employees.length,
        confirmed_count: 0,
        store_status: 'pending'
      }, {
        onConflict: 'year_month,store_id'
      });

    revalidatePath('/monthly-status');
    return { success: true, initialized: true, count: employees.length };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 更新單一員工的每月狀態
 */
export async function updateStaffStatus(
  statusId: string,
  updates: Partial<{
    monthly_status: MonthlyStatusType;
    work_days: number;
    work_hours: number;
    is_dual_position: boolean;
    has_manager_bonus: boolean;
    is_supervisor_rotation: boolean;
    position: string;
    notes: string;
  }>
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    const { data, error } = await supabase
      .from('monthly_staff_status')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', statusId)
      .select()
      .single();

    if (error) {
      console.error('Error updating staff status:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/monthly-status');
    return { success: true, data };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 提交門市狀態（店長送出審核）
 */
export async function submitStoreStatus(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 更新所有該門市該月的狀態為 submitted
    const { error: statusError } = await supabase
      .from('monthly_staff_status')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        submitted_by: user.id
      })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .eq('status', 'draft');

    if (statusError) {
      return { success: false, error: statusError.message };
    }

    // 更新門市摘要
    const { error: summaryError } = await supabase
      .from('monthly_store_summary')
      .update({
        store_status: 'submitted',
        submitted_at: new Date().toISOString(),
        submitted_by: user.id
      })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId);

    if (summaryError) {
      return { success: false, error: summaryError.message };
    }

    revalidatePath('/monthly-status');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 確認門市狀態（督導/經理確認）
 */
export async function confirmStoreStatus(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return { success: false, error: '權限不足，只有督導或經理可以確認' };
    }

    // 更新所有該門市該月的狀態為 confirmed
    const { error: statusError } = await supabase
      .from('monthly_staff_status')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: user.id
      })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId);

    if (statusError) {
      return { success: false, error: statusError.message };
    }

    // 計算已確認人數
    const { count } = await supabase
      .from('monthly_staff_status')
      .select('*', { count: 'exact', head: true })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .eq('status', 'confirmed');

    // 更新門市摘要
    const { error: summaryError } = await supabase
      .from('monthly_store_summary')
      .update({
        store_status: 'confirmed',
        confirmed_count: count || 0,
        confirmed_at: new Date().toISOString(),
        confirmed_by: user.id
      })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId);

    if (summaryError) {
      return { success: false, error: summaryError.message };
    }

    revalidatePath('/monthly-status');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 獲取所有門市的月度摘要
 */
export async function getMonthlyStoreSummaries(yearMonth: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    // 獲取用戶可管理的門市
    const managedResult = await getUserManagedStores();
    if (!managedResult.success) {
      return { success: false, error: managedResult.error, data: [] };
    }

    const storeIds = managedResult.data.map((s: any) => s.id);

    if (storeIds.length === 0) {
      return { success: true, data: [] };
    }

    const { data, error } = await supabase
      .from('monthly_store_summary')
      .select(`
        *,
        store:stores(*)
      `)
      .eq('year_month', yearMonth)
      .in('store_id', storeIds)
      .order('store_id');

    if (error) {
      console.error('Error fetching monthly store summaries:', error);
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * 匯出指定年月、門市的人員狀態資料（用於獎金計算）
 */
export async function exportMonthlyStatusForBonus(yearMonth: string, storeId?: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: [] };
    }

    let query = supabase
      .from('monthly_staff_status')
      .select(`
        *,
        store:stores(store_code, store_name)
      `)
      .eq('year_month', yearMonth)
      .eq('status', 'confirmed')
      .order('store_id')
      .order('employee_code');

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error exporting monthly status:', error);
      return { success: false, error: error.message, data: [] };
    }

    // 轉換為適合匯出的格式
    const exportData = (data || []).map(item => ({
      門市代碼: item.store?.store_code || '',
      門市名稱: item.store?.store_name || '',
      員工代號: item.employee_code || '',
      員工姓名: item.employee_name || '',
      職位: item.position || '',
      雇用類型: item.employment_type === 'full_time' ? '正職' : '兼職',
      是否藥師: item.is_pharmacist ? '是' : '否',
      本月狀態: getMonthlyStatusLabel(item.monthly_status),
      工作天數: item.work_days || '',
      本月總天數: item.total_days_in_month,
      工作時數: item.work_hours || '',
      是否雙職務: item.is_dual_position ? '是' : '否',
      店長加成資格: item.has_manager_bonus ? '是' : '否',
      督導卡班: item.is_supervisor_rotation ? '是' : '否',
      計算區塊: item.calculated_block || 0,
      備註: item.notes || ''
    }));

    return { success: true, data: exportData };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, data: [] };
  }
}

// 輔助函數：獲取狀態標籤
function getMonthlyStatusLabel(status: MonthlyStatusType): string {
  const labels: Record<MonthlyStatusType, string> = {
    'full_month': '整月在職',
    'new_hire': '到職',
    'resigned': '離職',
    'leave_of_absence': '留停',
    'transferred_in': '調入',
    'transferred_out': '調出',
    'promoted': '升職',
    'support_rotation': '支援卡班'
  };
  return labels[status] || status;
}
