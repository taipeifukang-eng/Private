// ============================================
// 角色使用者管理 API
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

// 定義員工資料型別
interface Employee {
  user_id: string;
  employee_code: string;
  employee_name: string;
}

function normalizeEmployeeCodes(codes: unknown[]): string[] {
  return Array.from(
    new Set(
      codes
        .map(code => String(code || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function isMissingOptionalTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = error.message || '';
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('schema cache') ||
    message.includes('Could not find the table')
  );
}

// 取得角色的所有使用者
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查查看權限
    const permission = await requirePermission(user.id, 'role.user_role.view');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id } = params;
    const adminSupabase = createAdminClient();

    // 取得角色的所有使用者
    const { data: userRoles, error } = await adminSupabase
      .from('user_roles')
      .select('id, user_id, is_active, assigned_at, expires_at, assigned_by')
      .eq('role_id', id)
      .order('assigned_at', { ascending: false });

    if (error) {
      console.error('取得角色使用者錯誤:', error);
      return NextResponse.json(
        { error: '取得使用者列表失敗' },
        { status: 500 }
      );
    }

    // 取得使用者資料
    const userIds = userRoles?.map(ur => ur.user_id) || [];
    
    if (userIds.length === 0) {
      return NextResponse.json(
        { users: [] },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // 取得 profiles（包含使用者管理中維護的基本資料）
    const { data: profiles } = await adminSupabase
      .from('profiles')
      .select('id, email, full_name, employee_code, department, job_title, role')
      .in('id', userIds);

    // 取得正式區 store_employees。DEV baseline 可能尚未建置此表；
    // 角色指派仍應可透過 profiles.employee_code 完成。
    const { data: employees, error: employeesError } = await adminSupabase
      .from('store_employees')
      .select('user_id, employee_code, employee_name')
      .in('user_id', userIds);

    if (employeesError && !isMissingOptionalTable(employeesError)) {
      console.error('取得 store_employees 摘要錯誤:', employeesError);
      return NextResponse.json(
        { error: '取得使用者列表失敗' },
        { status: 500 }
      );
    }

    // 合併資料。使用者管理維護的 profiles 是正式 RBAC 顯示來源；
    // store_employees 僅作為舊正式資料或相容表的備援。
    const users = (userRoles?.map(ur => {
      const profile = profiles?.find(p => p.id === ur.user_id);
      const employee = employeesError ? null : employees?.find(e => e.user_id === ur.user_id);
      
      return {
        id: ur.user_id,
        email: profile?.email || '',
        name: profile?.full_name || employee?.employee_name || '',
        employee_code: profile?.employee_code || employee?.employee_code || '',
        department: profile?.department || '',
        job_title: profile?.job_title || '',
        profile_role: profile?.role || 'member',
        is_active: ur.is_active,
        assigned_at: ur.assigned_at,
        expires_at: ur.expires_at
      };
    }) || []).sort((a, b) => {
      // 按員工編號排序，沒有員編的排在最後
      if (!a.employee_code && !b.employee_code) return 0;
      if (!a.employee_code) return 1;
      if (!b.employee_code) return -1;
      return a.employee_code.localeCompare(b.employee_code);
    });

    return NextResponse.json(
      { users },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('取得角色使用者異常:', error);
    return NextResponse.json(
      { error: '取得使用者列表失敗' },
      { status: 500 }
    );
  }
}

// 指派角色給使用者（支援批次新增）
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查指派權限
    const permission = await requirePermission(user.id, 'role.user_role.assign');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const roleId = params.id;
    const body = await request.json();
    const { employee_codes } = body; // 支援批次新增

    if (!employee_codes || !Array.isArray(employee_codes) || employee_codes.length === 0) {
      return NextResponse.json(
        { error: '請提供員工編號陣列' },
        { status: 400 }
      );
    }

    const employeeCodes = normalizeEmployeeCodes(employee_codes);
    if (employeeCodes.length === 0) {
      return NextResponse.json(
        { error: '請提供有效的員工編號' },
        { status: 400 }
      );
    }

    const adminSupabase = createAdminClient();

    // 檢查角色是否存在
    const { data: role, error: roleError } = await adminSupabase
      .from('roles')
      .select('id, code, name')
      .eq('id', roleId)
      .single();

    if (roleError || !role) {
      return NextResponse.json(
        { error: '角色不存在' },
        { status: 404 }
      );
    }

    // 查詢所有員工編號對應的 user_id。
    // 正式資料優先支援 store_employees；DEV / RBAC 測試使用者則可只存在 profiles。
    const { data: profileRows, error: profileError } = await adminSupabase
      .from('profiles')
      .select('id, employee_code, full_name, email')
      .in('employee_code', employeeCodes);

    if (profileError) {
      console.error('查詢 profiles 員工錯誤:', profileError);
      return NextResponse.json(
        { error: '查詢員工資料失敗' },
        { status: 500 }
      );
    }

    const { data: storeEmployeeRows, error: storeEmployeeError } = await adminSupabase
      .from('store_employees')
      .select('user_id, employee_code, employee_name')
      .in('employee_code', employeeCodes)
      .not('user_id', 'is', null);

    if (storeEmployeeError && !isMissingOptionalTable(storeEmployeeError)) {
      console.error('查詢 store_employees 員工錯誤:', storeEmployeeError);
      return NextResponse.json(
        { error: '查詢員工資料失敗' },
        { status: 500 }
      );
    }

    const employeeByUserId = new Map<string, Employee>();

    (storeEmployeeError ? [] : storeEmployeeRows || []).forEach((row: any) => {
      if (!row.user_id || !row.employee_code) return;
      employeeByUserId.set(row.user_id, {
        user_id: row.user_id,
        employee_code: String(row.employee_code).trim().toUpperCase(),
        employee_name: row.employee_name || row.employee_code,
      });
    });

    (profileRows || []).forEach((row: any) => {
      if (!row.id || !row.employee_code) return;
      const normalizedCode = String(row.employee_code).trim().toUpperCase();
      const existing = employeeByUserId.get(row.id);
      employeeByUserId.set(row.id, {
        user_id: row.id,
        employee_code: normalizedCode || existing?.employee_code || '',
        employee_name: row.full_name || existing?.employee_name || row.email || normalizedCode,
      });
    });

    const employees = Array.from(employeeByUserId.values())
      .filter(employee => employeeCodes.includes(employee.employee_code));

    if (!employees || employees.length === 0) {
      return NextResponse.json(
        { error: '找不到對應的員工資料，請確認員工編號是否正確且已綁定使用者帳號' },
        { status: 404 }
      );
    }

    // 檢查已指派的使用者
    const userIds = employees.map((e: Employee) => e.user_id);
    const { data: existingRoles } = await adminSupabase
      .from('user_roles')
      .select('user_id')
      .eq('role_id', roleId)
      .in('user_id', userIds);

    const existingUserIds = new Set(existingRoles?.map((er: any) => er.user_id) || []);

    // 過濾出需要新增的使用者
    const toInsert = employees
      .filter((emp: Employee) => !existingUserIds.has(emp.user_id))
      .map((emp: Employee) => ({
        user_id: emp.user_id,
        role_id: roleId,
        assigned_by: user.id,
        is_active: true,
        expires_at: null
      }));

    if (toInsert.length === 0) {
      const skippedNames = employees
        .filter((emp: Employee) => existingUserIds.has(emp.user_id))
        .map((emp: Employee) => `${emp.employee_name}(${emp.employee_code})`)
        .join('、');
      
      return NextResponse.json(
        { 
          message: `所有使用者均已擁有此角色`,
          details: `已跳過：${skippedNames}`,
          skipped: employees.length,
          added: 0
        },
        { status: 200 }
      );
    }

    // 批次插入
    const { error: insertError } = await adminSupabase
      .from('user_roles')
      .insert(toInsert);

    if (insertError) {
      console.error('指派角色錯誤:', insertError);
      return NextResponse.json(
        { error: '指派角色失敗' },
        { status: 500 }
      );
    }

    const addedNames = employees
      .filter((emp: Employee) => !existingUserIds.has(emp.user_id))
      .map((emp: Employee) => `${emp.employee_name}(${emp.employee_code})`)
      .join('、');

    const skippedNames = employees
      .filter((emp: Employee) => existingUserIds.has(emp.user_id))
      .map((emp: Employee) => `${emp.employee_name}(${emp.employee_code})`)
      .join('、');

    let message = `成功指派 ${toInsert.length} 個使用者「${role.name}」角色`;
    let details = `已新增：${addedNames}`;
    
    if (skippedNames) {
      details += `\n已跳過（已有此角色）：${skippedNames}`;
    }

    return NextResponse.json({ 
      message,
      details,
      added: toInsert.length,
      skipped: employees.length - toInsert.length
    }, { status: 201 });
  } catch (error) {
    console.error('指派角色異常:', error);
    return NextResponse.json(
      { error: '指派角色失敗' },
      { status: 500 }
    );
  }
}
