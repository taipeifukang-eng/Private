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
  short_name?: string;
  hr_store_code?: string;
  manager_name?: string;
  address?: string;
  phone?: string;
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查權限：admin 或營業部主管
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.job_title === '主管';
    if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor)) {
      return { success: false, error: '權限不足' };
    }

    const { data: store, error } = await supabase
      .from('stores')
      .insert({
        store_code: data.store_code,
        store_name: data.store_name,
        short_name: data.short_name || null,
        hr_store_code: data.hr_store_code || null,
        manager_name: data.manager_name || null,
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
 * 複製門市（搬移功能）
 * 將原門市的督導/經理關聯和員工複製到新門市
 */
export async function cloneStore(data: {
  source_store_id: string;
  new_store_code: string;
  new_store_name: string;
  new_short_name?: string;
  new_hr_store_code?: string;
  new_manager_name?: string;
  new_address?: string;
  new_phone?: string;
  copy_managers: boolean;  // 是否複製督導/經理關聯
  copy_employees: boolean; // 是否複製員工
  deactivate_source: boolean; // 是否停用原門市
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查權限：admin 或營業部主管（manager 角色，但不是需要指派的職位）
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor)) {
      return { success: false, error: '權限不足' };
    }

    // 1. 取得原門市資料
    const { data: sourceStore, error: sourceError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', data.source_store_id)
      .single();

    if (sourceError || !sourceStore) {
      return { success: false, error: '找不到原門市' };
    }

    // 2. 建立新門市
    const { data: newStore, error: createError } = await supabase
      .from('stores')
      .insert({
        store_code: data.new_store_code,
        store_name: data.new_store_name,
        short_name: data.new_short_name || sourceStore.short_name,
        hr_store_code: data.new_hr_store_code || sourceStore.hr_store_code,
        manager_name: data.new_manager_name || sourceStore.manager_name,
        address: data.new_address || sourceStore.address,
        phone: data.new_phone || sourceStore.phone,
        is_active: true
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating new store:', createError);
      return { success: false, error: `建立新門市失敗: ${createError.message}` };
    }

    let copiedManagers = 0;
    let copiedEmployees = 0;

    // 3. 複製督導/經理關聯
    if (data.copy_managers) {
      const { data: managers } = await supabase
        .from('store_managers')
        .select('*')
        .eq('store_id', data.source_store_id);

      if (managers && managers.length > 0) {
        const newManagerRecords = managers.map(m => ({
          store_id: newStore.id,
          user_id: m.user_id,
          role_type: m.role_type,
          is_primary: m.is_primary
        }));

        const { error: managerError } = await supabase
          .from('store_managers')
          .insert(newManagerRecords);

        if (!managerError) {
          copiedManagers = managers.length;
        }
      }
    }

    // 4. 複製員工
    if (data.copy_employees) {
      const { data: employees } = await supabase
        .from('store_employees')
        .select('*')
        .eq('store_id', data.source_store_id)
        .eq('is_active', true);

      if (employees && employees.length > 0) {
        const newEmployeeRecords = employees.map(e => ({
          store_id: newStore.id,
          user_id: e.user_id,
          employee_code: e.employee_code,
          position: e.position,
          employment_type: e.employment_type,
          is_pharmacist: e.is_pharmacist,
          is_active: true,
          start_date: e.start_date
        }));

        const { error: employeeError } = await supabase
          .from('store_employees')
          .insert(newEmployeeRecords);

        if (!employeeError) {
          copiedEmployees = employees.length;
        }
      }
    }

    // 5. 停用原門市（如果選擇）
    if (data.deactivate_source) {
      await supabase
        .from('stores')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', data.source_store_id);
    }

    revalidatePath('/admin/stores');
    return { 
      success: true, 
      data: newStore,
      copiedManagers,
      copiedEmployees,
      sourceDeactivated: data.deactivate_source
    };
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

    // 獲取用戶角色、部門和職位
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return { success: false, error: '找不到用戶資料', data: [] };
    }

    console.log('🔍 getUserManagedStores - 用戶資料:', {
      role: profile.role,
      department: profile.department,
      job_title: profile.job_title,
      isBusinessDept: profile.department?.startsWith('營業'),
      isBusinessMember: profile.role === 'member',
      isBusinessManager: profile.role === 'manager'
    });

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
      return { 
        success: true, 
        data: data || [], 
        role: 'admin',
        department: profile.department,
        job_title: profile.job_title
      };
    }

    // 需要指派才能看門市的職位：督導、店長、代理店長、督導(代理店長)
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');
    
    // 營業部人員（但不是需要指派的職位）可以看所有門市
    // 包括：助理、區經理等行政管理職位
    if (profile.department?.startsWith('營業') && (profile.role === 'member' || profile.role === 'manager') && !needsAssignment) {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .order('store_code');

      if (error) {
        return { success: false, error: error.message, data: [] };
      }
      return { 
        success: true, 
        data: data || [], 
        role: profile.role,
        department: profile.department,
        job_title: profile.job_title
      };
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

    return { 
      success: true, 
      data: stores, 
      role: roleType,
      department: profile.department,
      job_title: profile.job_title
    };
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

    // 檢查權限：admin 或營業部主管（manager 角色，但不是需要指派的職位）
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor)) {
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
        user:profiles!monthly_staff_status_user_id_fkey(id, email, full_name)
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

    // 計算本月天數
    const [year, month] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    // 計算上個月的年月
    const prevDate = new Date(year, month - 2, 1); // month-2 因為 JS 月份從 0 開始
    const prevYearMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    // 嘗試獲取上個月的資料
    const { data: prevMonthData } = await supabase
      .from('monthly_staff_status')
      .select('*')
      .eq('year_month', prevYearMonth)
      .eq('store_id', storeId);

    let statusRecords: any[] = [];

    if (prevMonthData && prevMonthData.length > 0) {
      // 有上個月的資料，從上個月複製
      statusRecords = prevMonthData.map(prev => {
        // 判斷是否為兼職（工作時數需重設為0）
        const isPartTime = prev.employment_type === 'part_time';
        
        // 判斷是否為區塊3（非整月，天數需重設）
        const isBlock3 = prev.calculated_block === 3;
        
        // 判斷是否為督導(代理店長)-雙（區塊4，時數需重設）
        const isBlock4 = prev.calculated_block === 4;

        return {
          year_month: yearMonth,
          store_id: storeId,
          user_id: prev.user_id,
          employee_code: prev.employee_code,
          employee_name: prev.employee_name,
          position: prev.position,
          employment_type: prev.employment_type,
          is_pharmacist: prev.is_pharmacist,
          start_date: prev.start_date,
          // 從上個月複製狀態，但區塊3的非整月需重設為整月
          monthly_status: isBlock3 ? 'full_month' as MonthlyStatusType : prev.monthly_status,
          // 正職：區塊3需重設天數為本月天數，其他維持上個月設定
          work_days: prev.employment_type === 'full_time' ? (isBlock3 ? daysInMonth : prev.work_days) : null,
          total_days_in_month: daysInMonth,
          // 兼職時數重設為0，區塊4時數也重設為0
          work_hours: (isPartTime || isBlock4) ? 0 : prev.work_hours,
          is_dual_position: prev.is_dual_position,
          has_manager_bonus: prev.has_manager_bonus,
          is_supervisor_rotation: prev.is_supervisor_rotation,
          // 新人等級維持
          newbie_level: prev.newbie_level,
          // 非整月原因（區塊3需清除）
          partial_month_reason: isBlock3 ? null : prev.partial_month_reason,
          partial_month_days: isBlock3 ? null : prev.partial_month_days,
          partial_month_notes: isBlock3 ? null : prev.partial_month_notes,
          // 督導卡班時數（區塊4需重設）
          supervisor_shift_hours: isBlock4 ? 0 : prev.supervisor_shift_hours,
          supervisor_employee_code: prev.supervisor_employee_code,
          supervisor_name: prev.supervisor_name,
          supervisor_position: prev.supervisor_position,
          // 額外任務維持
          extra_tasks: prev.extra_tasks,
          status: 'draft' as const
        };
      });
    } else {
      // 沒有上個月的資料，從員工設定初始化
      const { data: employees, error: empError } = await supabase
        .from('store_employees')
        .select('*')
        .eq('store_id', storeId)
        .eq('is_active', true);

      if (empError) {
        return { success: false, error: empError.message };
      }

      if (!employees || employees.length === 0) {
        return { success: false, error: '該門市沒有員工資料' };
      }

      statusRecords = employees.map(emp => {
        // 判斷是否有店長加成：只有「店長」或「代理店長」才有，「副店長」沒有
        const position = emp.position || '';
        const hasManagerBonus = position === '店長' || 
                               position === '代理店長' || 
                               position.includes('店長-雙') || 
                               position.includes('代理店長-雙');
        
        return {
          year_month: yearMonth,
          store_id: storeId,
          user_id: emp.user_id || null,
          employee_code: emp.employee_code,
          employee_name: emp.employee_name || '',
          position: emp.position,
          employment_type: emp.employment_type,
          is_pharmacist: emp.is_pharmacist,
          start_date: emp.start_date || null,
          monthly_status: 'full_month' as MonthlyStatusType,
          work_days: emp.employment_type === 'full_time' ? daysInMonth : null,
          total_days_in_month: daysInMonth,
          work_hours: emp.employment_type === 'part_time' ? 0 : null,
          is_dual_position: false,
          has_manager_bonus: hasManagerBonus,
          is_supervisor_rotation: false,
          status: 'draft' as const
        };
      });
    }

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
        total_employees: statusRecords.length,
        confirmed_count: 0,
        store_status: 'pending'
      }, {
        onConflict: 'year_month,store_id'
      });

    revalidatePath('/monthly-status');
    return { success: true, initialized: true, count: statusRecords.length };
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
    employment_type: 'full_time' | 'part_time';
    monthly_status: MonthlyStatusType;
    work_days: number;
    work_hours: number;
    is_dual_position: boolean;
    has_manager_bonus: boolean;
    is_supervisor_rotation: boolean;
    is_pharmacist: boolean;
    position: string;
    notes: string;
    start_date: string | null; // 到職日期
    // 新增欄位
    newbie_level: string | null;
    partial_month_reason: string | null;
    partial_month_days: number | null;
    partial_month_notes: string | null;
    supervisor_shift_hours: number | null;
    supervisor_employee_code: string | null;
    supervisor_name: string | null;
    supervisor_position: string | null;
    extra_tasks: string[] | null;
    // 外務時數
    extra_task_planned_hours: number | null;
    extra_task_external_hours: number | null;
    // 獎金費用
    last_month_single_item_bonus: number | null;
    talent_cultivation_bonus: number | null;
    talent_cultivation_target: string | null;
    // 交通費用
    monthly_transport_expense: number | null;
    transport_expense_notes: string | null;
    // 店長/代理店長支援時數
    support_to_other_stores_hours: number | null;
    support_from_other_stores_hours: number | null;
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
 * 檢查新人階段狀態
 */
export async function checkNewbieStatus(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    
    const { data: staffList } = await supabase
      .from('monthly_staff_status')
      .select('*')
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .eq('status', 'draft');

    if (!staffList || staffList.length === 0) {
      return { success: true, newbiesNeedCheck: [] };
    }

    const [year, month] = yearMonth.split('-').map(Number);
    const currentDate = new Date(year, month - 1, 1);
    const newbiesNeedCheck: any[] = [];

    for (const staff of staffList) {
      if (staff.start_date && (staff.position === '新人' || staff.monthly_status === 'new_hire')) {
        const hireDate = new Date(staff.start_date);
        const monthsDiff = (currentDate.getFullYear() - hireDate.getFullYear()) * 12 + 
                          (currentDate.getMonth() - hireDate.getMonth());

        let suggestedAction = '';
        
        // 到職日的第二個月，應該要過一階段
        if (monthsDiff >= 1 && staff.newbie_level !== '一階新人' && staff.newbie_level !== '二階新人') {
          suggestedAction = '應該過一階段';
        }
        // 到職日的第三個月，應該要過二階段
        else if (monthsDiff >= 2 && staff.newbie_level !== '二階新人') {
          suggestedAction = '應該過二階段';
        }
        // 到職日的第七個月，應該要過專員考試
        if (monthsDiff >= 6 && staff.position === '新人') {
          suggestedAction = '應該要過專員考試';
        }

        if (suggestedAction) {
          newbiesNeedCheck.push({
            id: staff.id,
            employee_code: staff.employee_code,
            employee_name: staff.employee_name,
            start_date: staff.start_date,
            current_level: staff.newbie_level || '未設定',
            suggested_action: suggestedAction
          });
        }
      }
    }

    return { success: true, newbiesNeedCheck };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, newbiesNeedCheck: [] };
  }
}

/**
 * 提交門市狀態（店長送出審核）
 */
export async function submitStoreStatus(yearMonth: string, storeId: string, skipNewbieCheck: boolean = false) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 如果沒有跳過檢查，先檢查新人階段狀態
    if (!skipNewbieCheck) {
      const checkResult = await checkNewbieStatus(yearMonth, storeId);
      if (checkResult.newbiesNeedCheck && checkResult.newbiesNeedCheck.length > 0) {
        return { 
          success: false, 
          needNewbieCheck: true,
          newbiesNeedCheck: checkResult.newbiesNeedCheck
        };
      }
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
 * 恢復提交狀態（將已提交回到待填寫）
 */
export async function revertSubmitStatus(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查權限：只有 admin 或 manager 可以恢復
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
      return { success: false, error: '權限不足，只有經理或管理員可以恢復提交狀態' };
    }

    // 將所有該門市該月的狀態從 submitted 改回 draft
    const { error: statusError } = await supabase
      .from('monthly_staff_status')
      .update({
        status: 'draft',
        submitted_at: null,
        submitted_by: null
      })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .eq('status', 'submitted');

    if (statusError) {
      return { success: false, error: statusError.message };
    }

    // 更新門市摘要
    const { error: summaryError } = await supabase
      .from('monthly_store_summary')
      .update({
        store_status: 'in_progress',
        submitted_at: null,
        submitted_by: null
      })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId);

    if (summaryError) {
      return { success: false, error: summaryError.message };
    }

    revalidatePath('/monthly-status');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 取消確認門市狀態（督導/經理取消確認）
 */
export async function unconfirmStoreStatus(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查權限：只有 admin、manager（經理）、或營業部助理主管可以取消確認
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const canUnconfirm = profile && (
      profile.role === 'admin' ||
      profile.role === 'manager' ||
      (profile.department === '營業部' && profile.job_title === '助理' && profile.role === 'manager')
    );

    if (!canUnconfirm) {
      return { success: false, error: '權限不足，只有經理或營業部助理主管可以取消確認' };
    }

    // 將所有該門市該月的狀態從 confirmed 改回 submitted
    const { error: statusError } = await supabase
      .from('monthly_staff_status')
      .update({
        status: 'submitted',
        confirmed_at: null,
        confirmed_by: null
      })
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .eq('status', 'confirmed');

    if (statusError) {
      return { success: false, error: statusError.message };
    }

    // 更新門市摘要
    const { error: summaryError } = await supabase
      .from('monthly_store_summary')
      .update({
        store_status: 'submitted',
        confirmed_count: 0,
        confirmed_at: null,
        confirmed_by: null
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

/**
 * 手動新增員工至每月狀態
 * 用於新增臨時或未在系統內的員工
 */
export async function addManualEmployee(
  yearMonth: string,
  storeId: string,
  employeeData: {
    employee_code?: string;
    employee_name: string;
    position: string;
    employment_type: 'full_time' | 'part_time';
    is_pharmacist: boolean;
    monthly_status: MonthlyStatusType;
    work_days?: number;
    work_hours?: number;
    notes?: string;
    // 新增欄位
    newbie_level?: string;
    partial_month_reason?: string;
    partial_month_days?: number;
    partial_month_notes?: string;
    supervisor_shift_hours?: number;
    supervisor_employee_code?: string;
    supervisor_name?: string;
    supervisor_position?: string;
    extra_tasks?: string[];
    extra_task_planned_hours?: number;
    extra_task_external_hours?: number;
    last_month_single_item_bonus?: number;
    talent_cultivation_bonus?: number;
    talent_cultivation_target?: string;
    monthly_transport_expense?: number;
    transport_expense_notes?: string;
    // 店長/代理店長支援時數
    support_to_other_stores_hours?: number;
    support_from_other_stores_hours?: number;
  }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 計算當月天數
    const [year, month] = yearMonth.split('-').map(Number);
    const totalDays = new Date(year, month, 0).getDate();

    // 預設工作天數
    const workDays = employeeData.work_days ?? (
      employeeData.monthly_status === 'full_month' ? totalDays : 0
    );

    const { data, error } = await supabase
      .from('monthly_staff_status')
      .insert({
        year_month: yearMonth,
        store_id: storeId,
        user_id: null, // 手動新增的員工沒有 user_id
        employee_code: employeeData.employee_code || null,
        employee_name: employeeData.employee_name,
        position: employeeData.position,
        employment_type: employeeData.employment_type,
        is_pharmacist: employeeData.is_pharmacist,
        monthly_status: employeeData.monthly_status,
        work_days: workDays,
        work_hours: employeeData.work_hours || null,
        total_days_in_month: totalDays,
        notes: employeeData.notes || null,
        status: 'draft',
        is_manually_added: true,
        // 新增欄位
        newbie_level: employeeData.newbie_level || null,
        partial_month_reason: employeeData.partial_month_reason || null,
        partial_month_days: employeeData.partial_month_days || null,
        partial_month_notes: employeeData.partial_month_notes || null,
        supervisor_shift_hours: employeeData.supervisor_shift_hours || null,
        supervisor_employee_code: employeeData.supervisor_employee_code || null,
        supervisor_name: employeeData.supervisor_name || null,
        supervisor_position: employeeData.supervisor_position || null,
        extra_tasks: employeeData.extra_tasks || null,
        extra_task_planned_hours: employeeData.extra_task_planned_hours || null,
        extra_task_external_hours: employeeData.extra_task_external_hours || null,
        last_month_single_item_bonus: employeeData.last_month_single_item_bonus || null,
        talent_cultivation_bonus: employeeData.talent_cultivation_bonus || null,
        talent_cultivation_target: employeeData.talent_cultivation_target || null,
        monthly_transport_expense: employeeData.monthly_transport_expense || null,
        transport_expense_notes: employeeData.transport_expense_notes || null,
        support_to_other_stores_hours: employeeData.support_to_other_stores_hours || null,
        support_from_other_stores_hours: employeeData.support_from_other_stores_hours || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding manual employee:', error);
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
 * 刪除每月狀態記錄（允許管理員和店長刪除）
 */
export async function deleteMonthlyStatusRecord(statusId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查用戶權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    // 獲取記錄信息以檢查權限
    const { data: existing, error: fetchError } = await supabase
      .from('monthly_staff_status')
      .select('is_manually_added, store_id')
      .eq('id', statusId)
      .single();

    if (fetchError) {
      return { success: false, error: '找不到該記錄' };
    }

    // 檢查是否為管理員或該門市的店長
    const { data: storeManager } = await supabase
      .from('store_managers')
      .select('id')
      .eq('user_id', user.id)
      .eq('store_id', existing.store_id)
      .maybeSingle();

    const isAdmin = profile?.role === 'admin';
    const isStoreManager = !!storeManager;

    if (!isAdmin && !isStoreManager) {
      return { success: false, error: '您沒有權限刪除此記錄' };
    }

    // 執行刪除
    const { error } = await supabase
      .from('monthly_staff_status')
      .delete()
      .eq('id', statusId);

    if (error) {
      console.error('Error deleting monthly status record:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/monthly-status');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 刪除員工及其相關記錄（包含月度狀態）
 */
export async function deleteStoreEmployee(employeeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查用戶角色和權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    
    console.log('User role:', profile?.role);

    // 獲取員工資料，使用 .maybeSingle() 避免錯誤
    const { data: employeeData, error: fetchError } = await supabase
      .from('store_employees')
      .select('user_id, store_id, employee_code, position')
      .eq('id', employeeId)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching employee:', fetchError);
      return { success: false, error: `無法取得員工資料: ${fetchError.message}` };
    }

    if (!employeeData) {
      return { success: false, error: '找不到該員工' };
    }

    console.log('Employee data:', employeeData);

    // 先刪除該員工在此門市的所有月度狀態記錄（使用 store_id 和 employee_code 來匹配）
    if (employeeData.employee_code) {
      const { error: deleteStatusError } = await supabase
        .from('monthly_staff_status')
        .delete()
        .eq('employee_code', employeeData.employee_code)
        .eq('store_id', employeeData.store_id);

      if (deleteStatusError) {
        console.error('Error deleting monthly status:', deleteStatusError);
        return { success: false, error: `刪除月度記錄失敗: ${deleteStatusError.message}` };
      }
    }

    // 刪除員工記錄
    const { error: deleteError } = await supabase
      .from('store_employees')
      .delete()
      .eq('id', employeeId);

    if (deleteError) {
      console.error('Error deleting employee:', deleteError);
      return { success: false, error: `刪除員工失敗: ${deleteError.message}` };
    }

    revalidatePath('/admin/stores');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// 門市每月統計資料 Actions
// =====================================================

/**
 * 獲取門市每月統計資料
 */
export async function getStoreMonthlySummary(yearMonth: string, storeId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入', data: null };
    }

    const { data, error } = await supabase
      .from('monthly_store_summary')
      .select('*')
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      console.error('Error fetching store summary:', error);
      return { success: false, error: error.message, data: null };
    }

    return { success: true, data: data || null };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message, data: null };
  }
}

/**
 * 更新門市每月統計資料
 */
export async function updateStoreMonthlySummary(
  yearMonth: string,
  storeId: string,
  stats: {
    total_staff_count: number;
    admin_staff_count: number;
    newbie_count: number;
    business_days: number;
    total_gross_profit: number;
    total_customer_count: number;
    prescription_addon_only_count: number;
    regular_prescription_count: number;
    chronic_prescription_count: number;
    support_to_other_stores_hours?: number;
    support_from_other_stores_hours?: number;
  }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: '未登入' };
    }

    // 檢查是否已存在
    const { data: existing } = await supabase
      .from('monthly_store_summary')
      .select('id')
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .single();

    if (existing) {
      // 更新
      const { error } = await supabase
        .from('monthly_store_summary')
        .update({
          ...stats,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) {
        console.error('Error updating store summary:', error);
        return { success: false, error: error.message };
      }
    } else {
      // 新增
      const { error } = await supabase
        .from('monthly_store_summary')
        .insert({
          year_month: yearMonth,
          store_id: storeId,
          ...stats,
          total_employees: 0,
          confirmed_count: 0,
          store_status: 'in_progress'
        });

      if (error) {
        console.error('Error inserting store summary:', error);
        return { success: false, error: error.message };
      }
    }

    revalidatePath('/monthly-status');
    return { success: true };
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return { success: false, error: error.message };
  }
}
