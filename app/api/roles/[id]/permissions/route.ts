// ============================================
// 角色權限管理 API
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

// 取得角色的所有權限
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
    const permission = await requirePermission(user.id, 'role.permission.view');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id } = params;

    // 取得所有權限
    const { data: allPermissions, error: permError } = await supabase
      .from('permissions')
      .select('*')
      .eq('is_active', true)
      .order('module')
      .order('feature')
      .order('action');

    if (permError) {
      console.error('取得權限列表錯誤:', permError);
      return NextResponse.json(
        { error: '取得權限列表失敗' },
        { status: 500 }
      );
    }

    // 取得角色已有的權限
    const { data: rolePermissions, error: rpError } = await supabase
      .from('role_permissions')
      .select('permission_id, is_allowed')
      .eq('role_id', id);

    if (rpError) {
      console.error('取得角色權限錯誤:', rpError);
      return NextResponse.json(
        { error: '取得角色權限失敗' },
        { status: 500 }
      );
    }

    // 建立權限對照表
    const permissionMap = new Map(
      rolePermissions?.map(rp => [rp.permission_id, rp.is_allowed]) || []
    );

    // 合併權限資料
    const permissions = allPermissions.map(perm => ({
      ...perm,
      granted: permissionMap.get(perm.id) || false
    }));

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error('取得角色權限異常:', error);
    return NextResponse.json(
      { error: '取得角色權限失敗' },
      { status: 500 }
    );
  }
}

// 更新角色權限
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

    // 檢查分配權限
    const permission = await requirePermission(user.id, 'role.permission.assign');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id } = params;
    const body = await request.json();
    const { permissionIds } = body;

    if (!Array.isArray(permissionIds)) {
      return NextResponse.json(
        { error: 'permissionIds 必須是陣列' },
        { status: 400 }
      );
    }

    // 檢查角色是否存在
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, is_system')
      .eq('id', id)
      .single();

    if (roleError || !role) {
      return NextResponse.json(
        { error: '角色不存在' },
        { status: 404 }
      );
    }

    // 先刪除現有權限
    const { error: deleteError } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', id);

    if (deleteError) {
      console.error('刪除舊權限錯誤:', deleteError);
      return NextResponse.json(
        { error: '更新權限失敗' },
        { status: 500 }
      );
    }

    // 如果有新權限，插入
    if (permissionIds.length > 0) {
      const newPermissions = permissionIds.map(permissionId => ({
        role_id: id,
        permission_id: permissionId,
        is_allowed: true,
        created_by: user.id
      }));

      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(newPermissions);

      if (insertError) {
        console.error('插入新權限錯誤:', insertError);
        return NextResponse.json(
          { error: '更新權限失敗' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ 
      success: true,
      message: `成功更新 ${permissionIds.length} 個權限`
    });
  } catch (error) {
    console.error('更新角色權限異常:', error);
    return NextResponse.json(
      { error: '更新角色權限失敗' },
      { status: 500 }
    );
  }
}
