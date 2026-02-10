// ============================================
// 角色使用者管理 API
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

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

    // 取得角色的所有使用者
    const { data: userRoles, error } = await supabase
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
      return NextResponse.json({ users: [] });
    }

    // 取得 profiles（包含員工編號）
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, employee_code')
      .in('id', userIds);

    // 取得 employees
    const { data: employees } = await supabase
      .from('store_employees')
      .select('user_id, employee_code, employee_name')
      .in('user_id', userIds);

    // 合併資料（優先使用 profiles 的員工編號）
    const users = (userRoles?.map(ur => {
      const profile = profiles?.find(p => p.id === ur.user_id);
      const employee = employees?.find(e => e.user_id === ur.user_id);
      
      return {
        id: ur.user_id,
        email: profile?.email || '',
        name: employee?.employee_name || profile?.full_name || '',
        employee_code: profile?.employee_code || employee?.employee_code || '',
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

    return NextResponse.json({ users });
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

    // 檢查角色是否存在
    const { data: role, error: roleError } = await supabase
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

    // 查詢所有員工編號對應的 user_id（使用 RPC 函數繞過 RLS）
    const { data: employees, error: empError } = await supabase
      .rpc('get_employees_by_codes', { codes: employee_codes });

    if (empError) {
      console.error('查詢員工錯誤:', empError);
      return NextResponse.json(
        { error: '查詢員工資料失敗' },
        { status: 500 }
      );
    }

    if (!employees || employees.length === 0) {
      return NextResponse.json(
        { error: '找不到對應的員工資料，請確認員工編號是否正確且已綁定使用者帳號' },
        { status: 404 }
      );
    }

    // 檢查已指派的使用者
    const userIds = employees.map(e => e.user_id);
    const { data: existingRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role_id', roleId)
      .in('user_id', userIds);

    const existingUserIds = new Set(existingRoles?.map(er => er.user_id) || []);

    // 過濾出需要新增的使用者
    const toInsert = employees
      .filter(emp => !existingUserIds.has(emp.user_id))
      .map(emp => ({
        user_id: emp.user_id,
        role_id: roleId,
        assigned_by: user.id,
        is_active: true,
        expires_at: null
      }));

    if (toInsert.length === 0) {
      const skippedNames = employees
        .filter(emp => existingUserIds.has(emp.user_id))
        .map(emp => `${emp.employee_name}(${emp.employee_code})`)
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
    const { error: insertError } = await supabase
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
      .filter(emp => !existingUserIds.has(emp.user_id))
      .map(emp => `${emp.employee_name}(${emp.employee_code})`)
      .join('、');

    const skippedNames = employees
      .filter(emp => existingUserIds.has(emp.user_id))
      .map(emp => `${emp.employee_name}(${emp.employee_code})`)
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
